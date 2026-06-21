import { wrap, type Remote } from 'comlink'
import type { ParserWorkerAPI } from '@/workers/parser.worker'
import type { EmbeddingWorkerAPI } from '@/workers/embedding.worker'

let parserWorker: Remote<ParserWorkerAPI> | null = null
let embeddingWorker: Remote<EmbeddingWorkerAPI> | null = null

/** Returns a singleton Comlink proxy for the parser worker */
export function getParserWorker(): Remote<ParserWorkerAPI> {
  if (!parserWorker) {
    const worker = new Worker(
      new URL('@/workers/parser.worker.ts', import.meta.url),
      { type: 'module' }
    )
    parserWorker = wrap<ParserWorkerAPI>(worker)
  }
  return parserWorker
}

/** Returns a singleton Comlink proxy for the embedding worker */
export function getEmbeddingWorker(): Remote<EmbeddingWorkerAPI> {
  if (!embeddingWorker) {
    const worker = new Worker(
      new URL('@/workers/embedding.worker.ts', import.meta.url),
      { type: 'module' }
    )
    embeddingWorker = wrap<EmbeddingWorkerAPI>(worker)
  }
  return embeddingWorker
}
