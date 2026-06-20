import { proxy } from 'comlink'
import { getParserWorker } from '@/workers/worker-api'
import type { ParseResult, ParseProgressCallback } from '@/workers/parser.worker'

export async function parseFile(
  file: File,
  onProgress?: ParseProgressCallback
): Promise<ParseResult> {
  const worker = getParserWorker()

  if (file.name.endsWith('.pdf') || file.type === 'application/pdf') {
    const buffer = await file.arrayBuffer()
    return worker.parsePdf(buffer, onProgress ? proxy(onProgress) : undefined)
  }

  if (
    file.name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const buffer = await file.arrayBuffer()
    return worker.parseDocx(buffer)
  }

  // TXT, MD, and any other text-based format
  const text = await file.text()
  return worker.parseText(text)
}
