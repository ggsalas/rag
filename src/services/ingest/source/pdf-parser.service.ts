import { proxy } from 'comlink'
import { getParserWorker } from '@/infrastructure/worker-pool'
import type {
  ParseResult,
  ParseProgressCallback,
} from '@/workers/pdf-parser.worker'

/**
 * Parses a PDF file into structured Markdown using the PDF-only LiteParse worker.
 * This is the sole PDF-specific adapter; nothing downstream imports LiteParse.
 */
export async function parsePdf(
  buffer: ArrayBuffer,
  onProgress?: ParseProgressCallback,
): Promise<ParseResult> {
  const worker = getParserWorker()
  return worker.parsePdf(buffer, onProgress ? proxy(onProgress) : undefined)
}
