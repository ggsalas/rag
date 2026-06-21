import { describe, it, expect } from 'vitest'
import { chunkText, chunkTextWithPages } from './chunking.service'

describe('chunking.service', () => {
  describe('chunkText', () => {
    it('should return empty array for empty text', () => {
      expect(chunkText('')).toEqual([])
      expect(chunkText('   ')).toEqual([])
    })

    it('should return single chunk for short text', () => {
      const chunks = chunkText('Hello world', { size: 500, overlap: 100 })
      expect(chunks).toHaveLength(1)
      expect(chunks[0]!.text).toBe('Hello world')
      expect(chunks[0]!.chunkIndex).toBe(0)
    })

    it('should split long text into multiple chunks', () => {
      const text = 'word '.repeat(200) // ~1000 chars
      const chunks = chunkText(text, { size: 300, overlap: 50 })
      expect(chunks.length).toBeGreaterThan(1)
    })

    it('should respect chunk size limit', () => {
      const text = 'word '.repeat(200)
      const chunks = chunkText(text, { size: 300, overlap: 50 })
      // Each chunk should be near max size (with some tolerance for word boundaries)
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeLessThanOrEqual(350)
      }
    })

    it('should assign sequential chunkIndex', () => {
      const text =
        'paragraph one.\n\nparagraph two.\n\nparagraph three.\n\nparagraph four.'
      const chunks = chunkText(text, { size: 30, overlap: 5 })
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i]!.chunkIndex).toBe(i)
      }
    })

    it('should use default size and overlap from constants', () => {
      const text = 'word '.repeat(300)
      const chunks = chunkText(text)
      expect(chunks.length).toBeGreaterThan(1)
    })
  })

  describe('chunkTextWithPages', () => {
    it('should assign page numbers', () => {
      const pages = [
        'Content of page one. It has multiple sentences. And more content here.',
        'Content of page two. Also with sentences.',
      ]
      const chunks = chunkTextWithPages(pages, { size: 60, overlap: 10 })
      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0]!.page).toBeDefined()
    })

    it('should handle empty pages', () => {
      const pages = ['', 'Content here', '']
      const chunks = chunkTextWithPages(pages, { size: 500, overlap: 100 })
      expect(chunks).toHaveLength(1)
      expect(chunks[0]!.text).toBe('Content here')
    })
  })
})
