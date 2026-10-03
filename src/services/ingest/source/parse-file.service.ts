import { parsePdf } from './pdf-parser.service'
import type { ParsedContent } from '../ingestion.types'
import type { ParseProgressCallback } from '@/workers/pdf-parser.worker'

/**
 * Error thrown when a file type is not supported (e.g. DOC/DOCX, unknown extensions).
 */
export class UnsupportedFileTypeError extends Error {
  constructor(fileName: string) {
    super(`Unsupported file type: ${fileName}`)
    this.name = 'UnsupportedFileTypeError'
  }
}

/**
 * Returns true if the file has a supported extension.
 *
 * Supported extensions (case-insensitive):
 * - PDF: `.pdf`
 * - Markdown: `.md`, `.markdown`
 * - Plain text: `.txt`
 *
 * Validation is extension-based. Files with unsupported extensions (including
 * DOC, DOCX, CSV, etc.) are rejected regardless of MIME type. MIME type is
 * only used as a fallback for extensionless files.
 */
export function isSupportedFile(file: File): boolean {
  const name = file.name.toLowerCase()

  // Check extension first (primary validation)
  if (name.endsWith('.pdf')) return true
  if (name.endsWith('.md') || name.endsWith('.markdown')) return true
  if (name.endsWith('.txt')) return true

  // For extensionless files, fall back to MIME type
  const hasExtension = name.includes('.')
  if (!hasExtension) {
    const mime = file.type
    if (mime === 'application/pdf') return true
    if (mime === 'text/plain') return true
    if (mime === 'text/markdown') return true
  }

  return false
}

/**
 * Infers the canonical content format for a supported file.
 * Returns null if the file is not supported.
 *
 * Uses extension-first validation. MIME type is only used as a fallback for
 * extensionless files.
 */
export function inferContentFormat(file: File): 'markdown' | 'text' | null {
  const name = file.name.toLowerCase()

  // Check extension first (primary validation)
  if (name.endsWith('.pdf')) return 'markdown'
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown'
  if (name.endsWith('.txt')) return 'text'

  // For extensionless files, fall back to MIME type
  const hasExtension = name.includes('.')
  if (!hasExtension) {
    const mime = file.type
    if (mime === 'application/pdf') return 'markdown'
    if (mime === 'text/markdown') return 'markdown'
    if (mime === 'text/plain') return 'text'
  }

  return null
}

/**
 * Validates a file and parses it through the appropriate source adapter.
 *
 * Source adapters map file types to canonical formats:
 * - PDF → markdown (via LiteParse)
 * - .md / .markdown → markdown (read as-is)
 * - .txt → text (read as-is)
 * - DOC / DOCX / unknown → rejected
 *
 * Validation is extension-based (case-insensitive). MIME type is only used as
 * a fallback for extensionless files. Files with unsupported extensions
 * (including DOC, DOCX, CSV, etc.) are rejected regardless of MIME type.
 *
 * @throws {UnsupportedFileTypeError} if the file type is not supported
 */
export async function parseFile(
  file: File,
  onProgress?: ParseProgressCallback,
): Promise<ParsedContent> {
  const name = file.name.toLowerCase()

  // Check extension first (primary validation)
  if (name.endsWith('.pdf')) {
    const buffer = await file.arrayBuffer()
    const result = await parsePdf(buffer, onProgress)
    return { text: result.text, format: 'markdown' }
  }

  if (name.endsWith('.md') || name.endsWith('.markdown')) {
    const text = await file.text()
    return { text, format: 'markdown' }
  }

  if (name.endsWith('.txt')) {
    const text = await file.text()
    return { text, format: 'text' }
  }

  // For extensionless files, fall back to MIME type
  const hasExtension = name.includes('.')
  if (!hasExtension) {
    const mime = file.type
    if (mime === 'application/pdf') {
      const buffer = await file.arrayBuffer()
      const result = await parsePdf(buffer, onProgress)
      return { text: result.text, format: 'markdown' }
    }
    if (mime === 'text/markdown') {
      const text = await file.text()
      return { text, format: 'markdown' }
    }
    if (mime === 'text/plain') {
      const text = await file.text()
      return { text, format: 'text' }
    }
  }

  // Everything else is unsupported (DOC, DOCX, CSV, unknown extensions, etc.)
  throw new UnsupportedFileTypeError(file.name)
}
