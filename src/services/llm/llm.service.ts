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
  LLM_NO_ANSWER_MESSAGE,
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

/**
 * One-shot, non-streaming LLM call. Returns the full completion as a string.
 * Used for auxiliary tasks (query expansion, HyDE) where we need the whole
 * output before continuing — not for user-facing answers, which stream.
 */
export async function generateOnce(
  prompt: string,
  maxTokens: number,
  temperature: number = 0.3,
): Promise<string> {
  if (!state.engine) throw new Error('LLM model not loaded')
  const engine = state.engine

  state.isRunning = true
  try {
    const response = await engine.chat.completions.create({
      messages: [{ role: 'user' as const, content: prompt }],
      stream: false,
      max_tokens: maxTokens,
      temperature,
      top_p: 0.9,
    })
    return response.choices[0]?.message?.content ?? ''
  } finally {
    state.isRunning = false
  }
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

  // No usable context: short-circuit with the canonical no-answer message
  // instead of calling the LLM. Small models (Llama 3.2 1B) confabulate from
  // pretraining knowledge when given an empty or off-topic context, so we
  // enforce the refusal deterministically here.
  if (topResults.length === 0) {
    onToken(LLM_NO_ANSWER_MESSAGE, false)
    onToken('', true)
    return []
  }

  const citations: LLMCitation[] = topResults.map((r, i) => ({
    index: i + 1,
    chunkId: r.chunkId,
    documentId: r.documentId,
    documentName: r.documentName,
    chunkIndex: r.chunkIndex,
  }))

  const context = topResults
    .map((r, i) => `[${i + 1}] ${r.text}`)
    .join('\n\n')

  // Task-framed prompt (not "You are an assistant..."): small chat-tuned
  // models like Llama-3.2-1B refuse less when primed as an extractor.
  // Explicit anti-hallucination guards are critical for models this size —
  // without them, the model streams plausible-sounding filler until it hits
  // max_tokens (e.g. fabricating other artists' discographies).
  //
  // Format guards ("no Step 1/2", "no $\\boxed{}$") suppress a specific
  // failure mode of Llama-3.2-1B-Instruct: it was fine-tuned on math-reasoning
  // traces and, when unconstrained, imitates that style even for factual Q&A.
  const systemPrompt =
    'Task: answer the user question using ONLY facts that appear literally in the sources below. ' +
    'The sources describe ONE specific document. Do not add other subjects, artists, works, dates, or facts that are not shown in the sources. Do not invent examples. Do not continue with related topics you might know from elsewhere.\n\n' +
    'The sources may be paragraphs, headings, or lists — a heading followed by items IS the answer for questions about that heading (e.g. "## Discography" followed by album titles answers "what is the discography").\n\n' +
    'Answer format:\n' +
    '- Reply with the actual factual content written out in words. NEVER reply with only a citation number like "2" or "[2]" — the citation goes AFTER the content, not instead of it.\n' +
    '- If the answer is a list of items (albums, dates, names…), reply as a plain hyphen-bulleted list, one item per line, then cite at the end.\n' +
    '- For a single fact, reply in 1-2 short sentences. No preamble.\n' +
    '- Output PLAIN TEXT ONLY. Do NOT add markdown emphasis: no `*`, no `_`, no `**`, no `__` around words. If the source has emphasis around titles, drop it.\n' +
    '- Do NOT show reasoning steps ("Step 1", "Step 2", "Let me think", etc.).\n' +
    '- Do NOT use math notation like $\\boxed{...}$ or "The final answer is:".\n' +
    '- Do NOT restate the question or the sources.\n' +
    '- Cite sources by placing [1] or [2] right after each fact you use.\n' +
    '- When you have covered the information present in the sources, stop.\n\n' +
    'Example — question "what is her discography?", source [2] contains "## Discography\\n- *Album A* (2001)\\n- *Album B* (2003)":\n' +
    '  Correct:\n' +
    '    - Album A (2001)\n' +
    '    - Album B (2003) [2]\n' +
    '  Wrong: "[2]", "2", "See [2].", "Her discography includes _Album A_ _Album B_"\n\n' +
    `Sources:\n${context}`

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: query },
  ]

  state.isRunning = true
  try {
    const stream = await engine.chat.completions.create({
      messages,
      stream: true,
      max_tokens: maxTokens,
      // Near-zero temperature + tight top_p → deterministic, terse answers
      // while leaving just enough entropy to escape token-repetition loops
      // (small models at pure t=0 can lock into patterns like `**_**_**_...`).
      // frequency_penalty > 0 further discourages the exact-same-token loops.
      temperature: 0.1,
      top_p: 0.9,
      frequency_penalty: 0.3,
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
