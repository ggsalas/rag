import { describe, it, expect } from 'vitest'
import {
  parseFile,
  isSupportedFile,
  inferContentFormat,
  UnsupportedFileTypeError,
} from './parse-file.service'

/** Creates a minimal File-like object for testing dispatch logic */
function makeFile(name: string, content: string, type = ''): File {
  return new File([content], name, { type })
}

describe('parse-file.service', () => {
  describe('isSupportedFile', () => {
    it('returns true for .pdf', () => {
      expect(isSupportedFile(makeFile('doc.pdf', ''))).toBe(true)
    })

    it('returns true for .md', () => {
      expect(isSupportedFile(makeFile('doc.md', ''))).toBe(true)
    })

    it('returns true for .markdown', () => {
      expect(isSupportedFile(makeFile('doc.markdown', ''))).toBe(true)
    })

    it('returns true for .txt', () => {
      expect(isSupportedFile(makeFile('doc.txt', ''))).toBe(true)
    })

    it('returns true for PDF MIME type', () => {
      expect(isSupportedFile(makeFile('doc', '', 'application/pdf'))).toBe(true)
    })

    it('returns true for text/plain MIME type', () => {
      expect(isSupportedFile(makeFile('doc', '', 'text/plain'))).toBe(true)
    })

    it('returns false for .docx', () => {
      expect(isSupportedFile(makeFile('doc.docx', ''))).toBe(false)
    })

    it('returns false for .doc', () => {
      expect(isSupportedFile(makeFile('doc.doc', ''))).toBe(false)
    })

    it('returns false for unknown extensions', () => {
      expect(isSupportedFile(makeFile('doc.xyz', ''))).toBe(false)
      expect(isSupportedFile(makeFile('image.png', ''))).toBe(false)
      expect(isSupportedFile(makeFile('data.json', ''))).toBe(false)
    })

    it('is case-insensitive', () => {
      expect(isSupportedFile(makeFile('DOC.PDF', ''))).toBe(true)
      expect(isSupportedFile(makeFile('README.MD', ''))).toBe(true)
      expect(isSupportedFile(makeFile('NOTES.TXT', ''))).toBe(true)
    })
  })

  describe('inferContentFormat', () => {
    it('returns markdown for .pdf', () => {
      expect(inferContentFormat(makeFile('doc.pdf', ''))).toBe('markdown')
    })

    it('returns markdown for .md', () => {
      expect(inferContentFormat(makeFile('doc.md', ''))).toBe('markdown')
    })

    it('returns markdown for .markdown', () => {
      expect(inferContentFormat(makeFile('doc.markdown', ''))).toBe('markdown')
    })

    it('returns text for .txt', () => {
      expect(inferContentFormat(makeFile('doc.txt', ''))).toBe('text')
    })

    it('returns null for unsupported types', () => {
      expect(inferContentFormat(makeFile('doc.docx', ''))).toBeNull()
      expect(inferContentFormat(makeFile('doc.xyz', ''))).toBeNull()
    })
  })

  describe('format dispatch', () => {
    it('routes .md files to markdown format', async () => {
      const file = makeFile('doc.md', '# Hello\n\nWorld.')
      const result = await parseFile(file)
      expect(result.format).toBe('markdown')
      expect(result.text).toContain('# Hello')
    })

    it('routes .markdown files to markdown format', async () => {
      const file = makeFile('doc.markdown', '## Section\n\nContent.')
      const result = await parseFile(file)
      expect(result.format).toBe('markdown')
    })

    it('routes .txt files to text format', async () => {
      const file = makeFile('notes.txt', 'Just plain text.\nNo markdown here.')
      const result = await parseFile(file)
      expect(result.format).toBe('text')
      expect(result.text).toContain('Just plain text.')
    })

    it('routes text/plain MIME type to text format', async () => {
      const file = makeFile('data.txt', 'Plain content', 'text/plain')
      const result = await parseFile(file)
      expect(result.format).toBe('text')
    })

    it('handles case-insensitive extensions', async () => {
      const fileUpper = makeFile('DOC.MD', '# Title')
      const resultUpper = await parseFile(fileUpper)
      expect(resultUpper.format).toBe('markdown')

      const fileTxtUpper = makeFile('NOTES.TXT', 'Plain text')
      const resultTxtUpper = await parseFile(fileTxtUpper)
      expect(resultTxtUpper.format).toBe('text')
    })
  })

  describe('unsupported file rejection', () => {
    it('rejects .docx files by extension', async () => {
      const file = makeFile('doc.docx', 'binary content')
      await expect(parseFile(file)).rejects.toThrow(UnsupportedFileTypeError)
    })

    it('rejects .doc files by extension', async () => {
      const file = makeFile('doc.doc', 'binary content')
      await expect(parseFile(file)).rejects.toThrow(UnsupportedFileTypeError)
    })

    it('rejects DOCX by MIME type', async () => {
      const file = makeFile(
        'document',
        'binary content',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      await expect(parseFile(file)).rejects.toThrow(UnsupportedFileTypeError)
    })

    it('rejects DOC by MIME type', async () => {
      const file = makeFile('document', 'binary content', 'application/msword')
      await expect(parseFile(file)).rejects.toThrow(UnsupportedFileTypeError)
    })

    it('rejects unknown extensions', async () => {
      const file = makeFile('data.json', '{}')
      await expect(parseFile(file)).rejects.toThrow(UnsupportedFileTypeError)
    })

    it('rejects .docx even with text/plain MIME type', async () => {
      const file = makeFile('report.docx', 'content', 'text/plain')
      expect(isSupportedFile(file)).toBe(false)
      expect(inferContentFormat(file)).toBeNull()
      await expect(parseFile(file)).rejects.toThrow(UnsupportedFileTypeError)
    })

    it('rejects .csv even with text/plain MIME type', async () => {
      const file = makeFile('data.csv', 'col1,col2', 'text/plain')
      expect(isSupportedFile(file)).toBe(false)
      expect(inferContentFormat(file)).toBeNull()
      await expect(parseFile(file)).rejects.toThrow(UnsupportedFileTypeError)
    })

    it('rejects .xlsx even with application/vnd.ms-excel MIME type', async () => {
      const file = makeFile('data.xlsx', 'binary', 'application/vnd.ms-excel')
      expect(isSupportedFile(file)).toBe(false)
      expect(inferContentFormat(file)).toBeNull()
      await expect(parseFile(file)).rejects.toThrow(UnsupportedFileTypeError)
    })

    it('throws UnsupportedFileTypeError with file name in message', async () => {
      const file = makeFile('report.docx', 'content')
      try {
        await parseFile(file)
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(UnsupportedFileTypeError)
        expect((err as Error).message).toContain('report.docx')
      }
    })
  })

  describe('PDF dispatch', () => {
    it('identifies .pdf files by extension (does not throw UnsupportedFileTypeError)', async () => {
      // We can't actually parse a real PDF in unit tests without the WASM worker,
      // but we verify the dispatch doesn't reject it.
      // The actual PDF parsing is tested via the worker integration.
      const file = makeFile('doc.pdf', '%PDF-1.4 fake', 'application/pdf')
      // parseFile will try to use the worker which isn't available in test env,
      // so we just verify it doesn't throw UnsupportedFileTypeError
      try {
        await parseFile(file)
      } catch (err) {
        expect(err).not.toBeInstanceOf(UnsupportedFileTypeError)
      }
    })
  })
})
