import { CreateMLCEngine, prebuiltAppConfig, type MLCEngine, type InitProgressReport } from '@mlc-ai/web-llm'
import type { SearchResult } from '@/types/search'
import { LLM_MODEL_ID, LLM_CONTEXT_CHUNKS, LLM_MAX_TOKENS } from '@/lib/constants'

export type LLMProgressCallback = (progress: number, text: string) => void
export type LLMTokenCallback = (token: string, done: boolean) => void

export interface LLMCitation {
  index: number
  chunkId: string
  documentId: string
  documentName: string
  page?: number
  chunkIndex: number
}

let engine: MLCEngine | null = null
let isRunning = false

/** Loads the LLM model (runs on the main thread via WebGPU — no worker needed) */
export async function initLLMModel(onProgress?: LLMProgressCallback): Promise<void> {
  const appConfig = {
    ...prebuiltAppConfig,
    model_list: prebuiltAppConfig.model_list.map((m) =>
      m.model_id === LLM_MODEL_ID
        ? { ...m, overrides: { ...m.overrides, sliding_window_size: -1 } }
        : m
    ),
  }
  engine = await CreateMLCEngine(LLM_MODEL_ID, {
    appConfig,
    initProgressCallback: (report: InitProgressReport) => {
      onProgress?.(report.progress, report.text)
    },
  })
}

/** Interrupts any in-progress generation. Safe to call when idle. */
export function abortLLMGeneration(): void {
  if (isRunning && engine) engine.interruptGenerate()
}

/** Streams an AI answer for the query using top search results as context */
export async function generateAnswer(
  query: string,
  results: SearchResult[],
  onToken: LLMTokenCallback,
  maxTokens: number = LLM_MAX_TOKENS,
): Promise<LLMCitation[]> {
  if (!engine) throw new Error('LLM model not loaded')

  const topResults = results.slice(0, LLM_CONTEXT_CHUNKS)

  const citations: LLMCitation[] = topResults.map((r, i) => ({
    index: i + 1,
    chunkId: r.chunkId,
    documentId: r.documentId,
    documentName: r.documentName,
    page: r.page,
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

  isRunning = true
  try {
    const stream = await engine.chat.completions.create({ messages, stream: true, max_tokens: maxTokens })

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
    isRunning = false
  }

  return citations
}
