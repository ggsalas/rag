import { describe, it, expect } from 'vitest'
import { chunkText, chunkMarkdown } from './chunking.service'

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
      expect(chunks[0]!.searchText).toBe('Hello world')
      expect(chunks[0]!.sectionPath).toEqual([])
      expect(chunks[0]!.headingText).toBe('')
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

    it('should generate searchText from plain text', () => {
      const chunks = chunkText('Hello world', { size: 500, overlap: 100 })
      expect(chunks[0]!.searchText).toBe('Hello world')
    })

    it('should have empty sectionPath and headingText for plain text', () => {
      const chunks = chunkText('Some paragraph.', { size: 500, overlap: 100 })
      expect(chunks[0]!.sectionPath).toEqual([])
      expect(chunks[0]!.headingText).toBe('')
    })
  })

  describe('chunkMarkdown', () => {
    it('chunks each section with heading tracked in sectionPath', () => {
      const text = `## Intro\n\nShort intro paragraph.\n\n## Body\n\nShort body paragraph.`
      const chunks = chunkMarkdown(text, { size: 500, overlap: 100 })
      expect(chunks).toHaveLength(2)
      // Heading is NOT in chunk text anymore — it's in sectionPath
      expect(chunks[0]!.sectionPath).toEqual(['Intro'])
      expect(chunks[0]!.headingText).toBe('Intro')
      expect(chunks[0]!.text).toContain('Short intro paragraph')
      expect(chunks[1]!.sectionPath).toEqual(['Body'])
      expect(chunks[1]!.headingText).toBe('Body')
      expect(chunks[1]!.text).toContain('Short body paragraph')
    })

    it('splits oversized sections via paragraph chunking', () => {
      const text = `## Big\n\n${'word '.repeat(300)}`
      const chunks = chunkMarkdown(text, { size: 300, overlap: 50 })
      expect(chunks.length).toBeGreaterThan(1)
      // All sub-chunks should inherit the section path
      for (const chunk of chunks) {
        expect(chunk.sectionPath).toEqual(['Big'])
        expect(chunk.headingText).toBe('Big')
      }
    })

    it('assigns sequential chunkIndex', () => {
      const text = `## A\n\nOne.\n\n## B\n\nTwo.\n\n## C\n\nThree.`
      const chunks = chunkMarkdown(text, { size: 500, overlap: 100 })
      chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i))
    })

    it('returns empty array for empty text', () => {
      expect(chunkMarkdown('')).toEqual([])
      expect(chunkMarkdown('   ')).toEqual([])
    })

    it('tracks nested heading hierarchy in sectionPath', () => {
      const text = `# Top\n\nIntro.\n\n## Sub A\n\nContent A.\n\n### Sub Sub\n\nDeep content.\n\n## Sub B\n\nContent B.`
      const chunks = chunkMarkdown(text, { size: 500, overlap: 100 })
      // Should have 4 chunks: Top content, Sub A content, Sub Sub content, Sub B content
      expect(chunks.length).toBe(4)
      expect(chunks[0]!.sectionPath).toEqual(['Top'])
      expect(chunks[1]!.sectionPath).toEqual(['Top', 'Sub A'])
      expect(chunks[2]!.sectionPath).toEqual(['Top', 'Sub A', 'Sub Sub'])
      expect(chunks[3]!.sectionPath).toEqual(['Top', 'Sub B'])
    })

    it('generates searchText without Markdown syntax', () => {
      const text = `## Heading\n\nA paragraph with **bold** and a [link](https://example.com).`
      const chunks = chunkMarkdown(text, { size: 500, overlap: 100 })
      expect(chunks).toHaveLength(1)
      // searchText should not contain Markdown syntax
      expect(chunks[0]!.searchText).not.toContain('**')
      expect(chunks[0]!.searchText).not.toContain('[')
      expect(chunks[0]!.searchText).not.toContain('](')
      // But should contain the visible text
      expect(chunks[0]!.searchText).toContain('bold')
      expect(chunks[0]!.searchText).toContain('link')
    })

    it('handles content before any heading', () => {
      const text = `Preamble text.\n\n## Section\n\nSection content.`
      const chunks = chunkMarkdown(text, { size: 500, overlap: 100 })
      expect(chunks).toHaveLength(2)
      // Preamble has no heading context
      expect(chunks[0]!.sectionPath).toEqual([])
      expect(chunks[0]!.headingText).toBe('')
      expect(chunks[0]!.text).toContain('Preamble text')
      // Section has heading context
      expect(chunks[1]!.sectionPath).toEqual(['Section'])
    })

    it('avoids orphan heading-only chunks', () => {
      // A heading with no content should not produce a chunk
      const text = `## Empty Heading\n\n## Real Section\n\nActual content here.`
      const chunks = chunkMarkdown(text, { size: 500, overlap: 100 })
      // Only the section with content should produce a chunk
      expect(chunks).toHaveLength(1)
      expect(chunks[0]!.sectionPath).toEqual(['Real Section'])
      expect(chunks[0]!.text).toContain('Actual content here')
    })

    it('preserves code block content in searchText without fences', () => {
      const text = `## Code\n\n\`\`\`js\nconst x = 1\n\`\`\``
      const chunks = chunkMarkdown(text, { size: 500, overlap: 100 })
      expect(chunks).toHaveLength(1)
      // searchText should contain code content but not fences
      expect(chunks[0]!.searchText).toContain('const x = 1')
      expect(chunks[0]!.searchText).not.toContain('```')
      // But chunk.text should preserve Markdown
      expect(chunks[0]!.text).toContain('```js')
    })
  })
})
