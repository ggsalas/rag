import { expose } from 'comlink'
import init, { LiteParse } from '@llamaindex/liteparse-wasm'
import { extractRawText } from 'mammoth'

let liteParseReady: Promise<void> | null = null

/** Lazily initialize the LiteParse WASM module once per worker */
function ensureLiteParse(): Promise<void> {
  if (!liteParseReady) liteParseReady = init().then(() => undefined)
  return liteParseReady
}

export interface ParseResult {
  /** Extracted text — markdown for PDF, raw text otherwise */
  text: string
}

export type ParseProgressCallback = (
  current: number,
  total: number,
) => void | Promise<void>

export interface ParserWorkerAPI {
  parsePdf(
    buffer: ArrayBuffer,
    onProgress?: ParseProgressCallback,
  ): Promise<ParseResult>
  parseDocx(buffer: ArrayBuffer): Promise<ParseResult>
  parseText(text: string): Promise<ParseResult>
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

/** Parses a DOCX file and extracts raw text content */
async function parseDocx(buffer: ArrayBuffer): Promise<ParseResult> {
  const result = await extractRawText({ arrayBuffer: buffer })
  return { text: result.value }
}

/** Returns text content as-is (for TXT and MD files) */
async function parseText(text: string): Promise<ParseResult> {
  return { text }
}

const api: ParserWorkerAPI = { parsePdf, parseDocx, parseText }
expose(api)
