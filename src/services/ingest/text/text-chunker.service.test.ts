import { describe, it, expect } from 'vitest'
import { chunkPlainText } from './text-chunker.service'

describe('text-chunker.service', () => {
  describe('chunkPlainText', () => {
    it('returns empty array for empty text', () => {
      expect(chunkPlainText('')).toEqual([])
      expect(chunkPlainText('   ')).toEqual([])
    })

    it('returns single chunk for short text', () => {
      const chunks = chunkPlainText('Hello world', { size: 500, overlap: 100 })
      expect(chunks).toHaveLength(1)
      expect(chunks[0]!.text).toBe('Hello world')
      expect(chunks[0]!.searchText).toBe('Hello world')
      expect(chunks[0]!.sectionPath).toEqual([])
      expect(chunks[0]!.headingText).toBe('')
    })

    it('searchText equals text (no Markdown stripping)', () => {
      const chunks = chunkPlainText('Some plain text.', {
        size: 500,
        overlap: 100,
      })
      expect(chunks[0]!.searchText).toBe(chunks[0]!.text)
    })

    it('preserves Markdown-like strings literally in chunks', () => {
      // TXT content with Markdown-like syntax must not be interpreted
      const text = '# Not a heading\n\n**Not bold**\n\n[Not a link](url)'
      const chunks = chunkPlainText(text, { size: 500, overlap: 100 })
      expect(chunks).toHaveLength(1)
      expect(chunks[0]!.text).toContain('# Not a heading')
      expect(chunks[0]!.text).toContain('**Not bold**')
      expect(chunks[0]!.text).toContain('[Not a link](url)')
      expect(chunks[0]!.searchText).toContain('# Not a heading')
    })

    it('splits long text into multiple chunks at paragraph boundaries', () => {
      const paragraphs = Array.from(
        { length: 20 },
        (_, i) => `Paragraph ${i}: ${'word '.repeat(20)}`,
      )
      const text = paragraphs.join('\n\n')
      const chunks = chunkPlainText(text, { size: 300, overlap: 50 })
      expect(chunks.length).toBeGreaterThan(1)
    })

    it('splits oversized paragraphs by sentences (never mid-word)', () => {
      const longParagraph =
        'First sentence here. Second sentence here. Third sentence here. Fourth sentence here. Fifth sentence here.'
      const chunks = chunkPlainText(longParagraph, { size: 100, overlap: 20 })
      expect(chunks.length).toBeGreaterThan(1)
      // All chunks should have non-empty text
      for (const chunk of chunks) {
        expect(chunk.text.trim().length).toBeGreaterThan(0)
      }
    })

    it('never splits mid-word', () => {
      // A long word without spaces should end up in its own chunk, not split
      const longWord = 'a'.repeat(200)
      const text = `Before. ${longWord} After.`
      const chunks = chunkPlainText(text, { size: 100, overlap: 0 })
      // The long word should appear intact in at least one chunk
      const found = chunks.some((c) => c.text.includes(longWord))
      expect(found).toBe(true)
    })

    it('assigns sequential chunkIndex', () => {
      const text = 'one.\n\ntwo.\n\nthree.\n\nfour.'
      const chunks = chunkPlainText(text, { size: 30, overlap: 5 })
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i]!.chunkIndex).toBe(i)
      }
    })

    it('always has empty sectionPath and headingText', () => {
      const text = 'Some paragraph.\n\nAnother paragraph.'
      const chunks = chunkPlainText(text, { size: 500, overlap: 100 })
      for (const chunk of chunks) {
        expect(chunk.sectionPath).toEqual([])
        expect(chunk.headingText).toBe('')
      }
    })

    it('packs whole paragraphs atomically', () => {
      const paragraphs = [
        'First paragraph with some content.',
        'Second paragraph with different content.',
        'Third paragraph that is also unique.',
        'Fourth paragraph to make things add up.',
      ]
      const text = paragraphs.join('\n\n')
      const chunks = chunkPlainText(text, { size: 80, overlap: 0 })
      expect(chunks.length).toBeGreaterThan(1)

      // Every original paragraph must appear whole in exactly one chunk
      for (const para of paragraphs) {
        const matches = chunks.filter((c) => c.text.includes(para))
        expect(matches).toHaveLength(1)
      }
    })

    it('does not send text through Markdown parser', () => {
      // Verify that Markdown-like syntax is preserved as-is
      const text = 'Line with **asterisks** and [brackets](url) and # hashes.'
      const chunks = chunkPlainText(text, { size: 500, overlap: 100 })
      expect(chunks[0]!.text).toBe(text)
      expect(chunks[0]!.searchText).toBe(text)
    })
  })
})
