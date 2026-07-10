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
}
const globalKey = '__llmModuleState__'
const state: LlmModuleState = ((
  globalThis as unknown as Record<string, LlmModuleState>
)[globalKey] ??= {
  engine: null,
  isRunning: false,
})

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

  state.engine = await CreateMLCEngine(LLM_MODEL_ID, {
    appConfig,
    initProgressCallback: (report: InitProgressReport) => {
      onProgress?.(report.progress, report.text)
    },
  })
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

  const topResults = results.slice(0, LLM_CONTEXT_CHUNKS)

  const citations: LLMCitation[] = topResults.map((r, i) => ({
    index: i + 1,
    chunkId: r.chunkId,
    documentId: r.documentId,
    documentName: r.documentName,
    chunkIndex: r.chunkIndex,
  }))

  const context = topResults.map((r, i) => `[${i + 1}] ${r.text}`).join('\n\n')

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
    if (msg.toLowerCase().includes('interrupt')) return citations
    throw err
  } finally {
    state.isRunning = false
  }

  return citations
}
