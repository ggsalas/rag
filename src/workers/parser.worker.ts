import { expose } from 'comlink'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import { extractRawText } from 'mammoth'

// Configure pdfjs worker
GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export interface ParseResult {
  text: string
  pages?: string[] // only for PDF
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

/** Parses a PDF file and extracts text content with page information */
async function parsePdf(
  buffer: ArrayBuffer,
  onProgress?: ParseProgressCallback,
): Promise<ParseResult> {
  const doc = await getDocument({ data: buffer }).promise
  const pages: string[] = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map((item: any) => {
        if ('str' in item) {
          return item.str
        }
        return ''
      })
      .join(' ')
    pages.push(text)
    await onProgress?.(i, doc.numPages)
  }

  return {
    text: pages.join('\n\n'),
    pages,
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
