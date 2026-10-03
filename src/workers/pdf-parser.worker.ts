import { expose } from 'comlink'
import init, { LiteParse } from '@llamaindex/liteparse-wasm'

let liteParseReady: Promise<void> | null = null

/** Lazily initialize the LiteParse WASM module once per worker */
function ensureLiteParse(): Promise<void> {
  if (!liteParseReady) liteParseReady = init().then(() => undefined)
  return liteParseReady
}

export interface ParseResult {
  /** Extracted text — Markdown output from LiteParse */
  text: string
}

export type ParseProgressCallback = (
  current: number,
  total: number,
) => void | Promise<void>

/** PDF-only parser worker API. No DOCX/TXT methods — text formats are read directly. */
export interface ParserWorkerAPI {
  parsePdf(
    buffer: ArrayBuffer,
    onProgress?: ParseProgressCallback,
  ): Promise<ParseResult>
}

/** Parses a PDF file into structured markdown using LiteParse (PDFium) */
async function parsePdf(
  buffer: ArrayBuffer,
  onProgress?: ParseProgressCallback,
): Promise<ParseResult> {
  await ensureLiteParse()

  // LiteParse is atomic (no per-page progress callback). Emit start/end signals.
  await onProgress?.(0, 1)

  const parser = new LiteParse({
    outputFormat: 'markdown',
    imageMode: 'off',
    extractLinks: true,
    quiet: true,
    preserveVerySmallText: false,
  })

  try {
    const bytes = new Uint8Array(buffer)
    const result = await parser.parse(bytes)
    await onProgress?.(1, 1)
    return { text: result.text }
  } finally {
    parser.free()
  }
}

const api: ParserWorkerAPI = { parsePdf }
expose(api)
