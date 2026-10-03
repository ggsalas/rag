import {
  CreateMLCEngine,
  prebuiltAppConfig,
  type MLCEngine,
  type InitProgressReport,
} from '@mlc-ai/web-llm'
import type { SearchResult } from '@/types/search'
import {
  LLM_MODEL_ID,
  LLM_CONTEXT_CHUNKS,
  LLM_CONTEXT_BUDGET_CHARS,
  LLM_CONTEXT_CHUNK_MAX_CHARS,
  LLM_MAX_TOKENS,
} from '@/lib/constants'

export type LLMProgressCallback = (progress: number, text: string) => void
export type LLMTokenCallback = (token: string, done: boolean) => void

export interface LLMCitation {
  index: number
  chunkId: string
  documentId: string
  documentName: string
  chunkIndex: number
}

// The engine + isRunning flag live on a globalThis singleton so that HMR / React
// Fast Refresh re-evaluations of this module don't lose the running engine. Vite's
// hot.dispose() doesn't fire in all re-eval paths (react-refresh can re-import the
// module without dispose), and a null engine after HMR would leave the store's
// llmStatus='ready' out of sync with the actual runtime. A window-scoped store
// survives every re-eval within the tab.
interface LlmModuleState {
  engine: MLCEngine | null
  isRunning: boolean
  activeLoad: Promise<boolean> | null
}
const globalKey = '__llmModuleState__'
const state: LlmModuleState = ((
  globalThis as unknown as Record<string, LlmModuleState>
)[globalKey] ??= {
  engine: null,
  isRunning: false,
  activeLoad: null,
})

/** Result of {@link buildContext}: the assembled prompt context and matching citations. */
export interface BuildContextResult {
  /** Plain-text context block with citation labels like `[1] …`. */
  context: string
  /** Citations for the chunks that fit within the budget, in input order. */
  citations: LLMCitation[]
}

/**
 * Builds the LLM context string and citation list from search results.
 *
 * - Uses each result's `searchText` (plain text) rather than its Markdown `text`,
 *   so partial Markdown cannot leak into the prompt.
 * - Truncates each chunk to the per-chunk character budget.
 * - Stops adding chunks once the total character budget is reached.
 * - Preserves input order; citation numbers are 1-based and sequential for
 *   the chunks that actually fit.
 *
 * Pure and deterministic — safe to unit-test.
 */
export function buildContext(
  results: SearchResult[],
  options: {
    totalBudget?: number
    chunkMax?: number
  } = {},
): BuildContextResult {
  const totalBudget = options.totalBudget ?? LLM_CONTEXT_BUDGET_CHARS
  const chunkMax = options.chunkMax ?? LLM_CONTEXT_CHUNK_MAX_CHARS

  const citations: LLMCitation[] = []
  const parts: string[] = []
  let total = 0

  for (const r of results) {
    const raw = r.searchText ?? ''
    const truncated = raw.length > chunkMax ? raw.slice(0, chunkMax) : raw
    const piece = `[${citations.length + 1}] ${truncated}`
    // Account for the "\n\n" separator between pieces.
    const additional = parts.length === 0 ? piece.length : piece.length + 2
    if (total + additional > totalBudget) break

    citations.push({
      index: citations.length + 1,
      chunkId: r.chunkId,
      documentId: r.documentId,
      documentName: r.documentName,
      chunkIndex: r.chunkIndex,
    })
    parts.push(piece)
    total += additional
  }

  return { context: parts.join('\n\n'), citations }
}

/**
 * Returns true when the error message looks like a WebGPU runtime failure
 * (device/buffer/context loss, mapAsync errors, a disposed engine object,
 * or an invalidated instance reference — e.g. a stale engine surviving HMR
 * or a failed reload). These indicate the engine is in a broken state and
 * should be discarded so it can be reloaded.
 */
function isGpuRuntimeError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('mapasync') ||
    m.includes('gpubuffer') ||
    m.includes('unmapped') ||
    m.includes('device lost') ||
    m.includes('device_lost') ||
    m.includes('context lost') ||
    m.includes('context_lost') ||
    m.includes('been disposed') ||
    // WebGPU validation: an external Instance reference (bind group, pipeline
    // layout, etc.) has been destroyed while still in use. Treated like a
    // disposed-object error — the engine is unusable and must be reloaded.
    m.includes('instance reference')
  )
}

/** Returns true when the error message indicates the LLM context window was exceeded. */
function isContextWindowError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('context window') ||
    m.includes('context length') ||
    m.includes('maximum context') ||
    m.includes('too many tokens')
  )
}

/** Loads the LLM model (runs on the main thread via WebGPU — no worker needed) */
export async function initLLMModel(
  onProgress?: LLMProgressCallback,
): Promise<void> {
  if (!navigator.gpu) {
    throw new Error(
      'Your browser does not support WebGPU. Try an up-to-date Chrome, Edge or Arc.',
    )
  }
  const adapter = await navigator.gpu.requestAdapter().catch(() => null)
  if (!adapter) {
    throw new Error(
      'No compatible GPU found. Make sure hardware acceleration is enabled in your browser.',
    )
  }

  const appConfig = {
    ...prebuiltAppConfig,
    model_list: prebuiltAppConfig.model_list.map((m) =>
      m.model_id === LLM_MODEL_ID
        ? { ...m, overrides: { ...m.overrides, sliding_window_size: -1 } }
        : m,
    ),
  }

  try {
    state.engine = await CreateMLCEngine(LLM_MODEL_ID, {
      appConfig,
      initProgressCallback: (report: InitProgressReport) => {
        onProgress?.(report.progress, report.text)
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (isGpuRuntimeError(msg)) {
      state.engine = null
      throw new Error(
        'GPU error while loading the AI model. Try reloading the page, or check your browser\'s hardware acceleration settings.',
      )
    }
    throw err
  }
}

/** Interrupts any in-progress generation. Safe to call when idle. */
export function abortLLMGeneration(): void {
  if (state.isRunning && state.engine) state.engine.interruptGenerate()
}

/** Streams an AI answer for the query using top search results as context */
export async function generateAnswer(
  query: string,
  results: SearchResult[],
  onToken: LLMTokenCallback,
  maxTokens: number = LLM_MAX_TOKENS,
): Promise<LLMCitation[]> {
  if (!state.engine) throw new Error('LLM model not loaded')
  const engine = state.engine

  // Hard cap on the number of results considered (defensive); the character
  // budget in buildContext is usually the tighter constraint.
  const topResults = results.slice(0, LLM_CONTEXT_CHUNKS)
  const { context, citations } = buildContext(topResults)

  const messages = [
    {
      role: 'system' as const,
      content: `Answer using ONLY the provided sources. Place citation numbers like [1] or [2] immediately after each relevant sentence — never group them at the end. Be concise.\n\nSources:\n${context}`,
    },
    { role: 'user' as const, content: query },
  ]

  state.isRunning = true
  try {
    const stream = await engine.chat.completions.create({
      messages,
      stream: true,
      max_tokens: maxTokens,
    })

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? ''
      if (token) onToken(token, false)
    }

    onToken('', true)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const lower = msg.toLowerCase()
    // User-initiated abort: return whatever citations we built.
    if (lower.includes('interrupt')) return citations
    // WebGPU runtime failure: discard the broken engine so the next attempt
    // reloads it, and surface a concise actionable message.
    if (isGpuRuntimeError(msg)) {
      state.engine = null
      throw new Error(
        'GPU error during answer generation. The AI model has been reset — please try again. If this persists, reload the page or check your browser\'s hardware acceleration settings.',
      )
    }
    // Model refused the prompt because it exceeded its context window.
    if (isContextWindowError(msg)) {
      throw new Error(
        'The answer context exceeded the model\'s limit. Try a shorter query or fewer results.',
      )
    }
    // Anything else is unrelated — rethrow untouched so callers can handle it.
    throw err
  } finally {
    state.isRunning = false
  }

  return citations
}

/** Options for managing model loading UI and state */
export interface ModelLoadCallbacks {
  getStatus: () => string
  setStatus: (status: string) => void
  setProgress: (progress: number) => void
  subscribe: (listener: (status: string) => void) => () => void
  showToast?: () => void
  dismissToast?: () => void
  showErrorToast?: (message: string) => void
}

// Tracks an in-flight model load initiated by ensureModelLoaded so concurrent
// callers share one load instead of each triggering their own (e.g. two callers
// detecting the same stale-ready state simultaneously). Stored on the module
// state singleton so tests can reset it between cases.

/**
 * Loads the LLM model if not already ready.
 * Returns true if the model is ready after the call. Respects abort signal.
 *
 * Detects stale 'ready' status: when the store reports ready but the module
 * engine singleton is null (cleared by a GPU runtime error in generateAnswer,
 * or lost during HMR), falls through to reload instead of returning true —
 * which would cause generateAnswer to throw "LLM model not loaded".
 */
export async function ensureModelLoaded(
  signal: AbortSignal,
  callbacks: ModelLoadCallbacks,
): Promise<boolean> {
  const status = callbacks.getStatus()

  // Happy path: store says ready AND we actually have a live engine.
  if (status === 'ready' && state.engine !== null) return true

  // Another load is already in flight (store says 'loading', or a concurrent
  // caller already detected the same stale-ready state): wait for it.
  if (status === 'loading' || state.activeLoad) {
    return waitForModelReady(signal, callbacks)
  }

  // Stale 'ready' (engine cleared by GPU error / HMR) or idle/error: load.
  callbacks.setStatus('loading')
  callbacks.setProgress(0)
  callbacks.showToast?.()

  const load = (async () => {
    try {
      await initLLMModel((progress) => {
        if (signal.aborted) return
        callbacks.setProgress(Math.round(progress * 100))
      })
      if (signal.aborted) return false
      callbacks.setStatus('ready')
      setTimeout(() => callbacks.dismissToast?.(), 2000)
      return true
    } catch (err) {
      if (signal.aborted) return false
      const message = err instanceof Error ? err.message : 'Failed to load AI model'
      callbacks.setStatus('error')
      callbacks.showErrorToast?.(message)
      return false
    } finally {
      // Clear the active load tracker. If a new load has started, it will have
      // already set state.activeLoad to a new promise before this runs.
      state.activeLoad = null
    }
  })()

  state.activeLoad = load
  return load
}

/** Waits for LLM status to leave 'loading' state. Resolves true if ready, false otherwise. */
function waitForModelReady(
  signal: AbortSignal,
  callbacks: ModelLoadCallbacks,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(false); return }

    const unsub = callbacks.subscribe((status) => {
      if (status === 'ready') {
        unsub()
        resolve(true)
      } else if (status === 'error' || status === 'idle') {
        unsub()
        resolve(false)
      }
    })

    signal.addEventListener('abort', () => {
      unsub()
      resolve(false)
    }, { once: true })
  })
}
