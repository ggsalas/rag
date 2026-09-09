import { describe, it, expect } from 'vitest'
import { chunkText, chunkMarkdown, type ChunkData } from './chunking.service'

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

    it('should split long text into multiple chunks when multiple paragraphs exist', () => {
      // Use multiple paragraphs (not one big paragraph) so chunking splits on paragraph boundaries
      const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph ${i}: ${'word '.repeat(20)}`)
      const text = paragraphs.join('\n\n')
      const chunks = chunkText(text, { size: 300, overlap: 50 })
      expect(chunks.length).toBeGreaterThan(1)
    })

    it('should not exceed size for well-separated paragraphs', () => {
      const paragraphs = Array.from({ length: 20 }, (_, i) => `P${i}: ${'word '.repeat(10)}`)
      const text = paragraphs.join('\n\n')
      const chunks = chunkText(text, { size: 300, overlap: 50 })
      // Chunks that don't contain an oversized paragraph should respect size
      for (const chunk of chunks) {
        // Each chunk is made of whole paragraphs; may exceed size only if a single paragraph exceeds it
        const paragraphsInChunk = chunk.text.split(/\n\s*\n/)
        if (paragraphsInChunk.length > 1) {
          expect(chunk.text.length).toBeLessThanOrEqual(350)
        }
      }
    })

    it('should keep a single long paragraph as one oversized chunk without cutting', () => {
      const longParagraph = 'word '.repeat(200) // ~1000 chars, no blank lines
      const chunks = chunkText(longParagraph, { size: 300, overlap: 50 })
      // A single paragraph is atomic — never split, even if it exceeds size
      expect(chunks).toHaveLength(1)
      expect(chunks[0]!.text).toBe(longParagraph.trim())
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
      // Multiple paragraphs so chunking can split on paragraph boundaries
      const paragraphs = Array.from({ length: 50 }, (_, i) => `P${i}: ${'word '.repeat(20)}`)
      const text = paragraphs.join('\n\n')
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

    it('should never partially split a paragraph across chunks', () => {
      // Each paragraph is atomic: it appears whole in exactly one chunk
      const paragraphs = [
        'First paragraph with some content.',
        'Second paragraph with different content.',
        'Third paragraph that is also unique.',
        'Fourth paragraph to fill things up.',
      ]
      const text = paragraphs.join('\n\n')
      const chunks = chunkText(text, { size: 80, overlap: 0 })
      expect(chunks.length).toBeGreaterThan(1)

      // Every original paragraph must appear whole in exactly one chunk
      for (const para of paragraphs) {
        const matches = chunks.filter((c) => c.text.includes(para))
        expect(matches).toHaveLength(1)
      }
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

    it('keeps a single oversized Markdown block as one chunk without cutting', () => {
      // A single long paragraph under a heading is one atomic block — never split
      const longParagraph = 'word '.repeat(300)
      const text = `## Big\n\n${longParagraph}`
      const chunks = chunkMarkdown(text, { size: 300, overlap: 50 })
      expect(chunks).toHaveLength(1)
      expect(chunks[0]!.sectionPath).toEqual(['Big'])
      expect(chunks[0]!.headingText).toBe('Big')
      expect(chunks[0]!.text).toBe(longParagraph.trim())
    })

    it('splits sections with multiple blocks into separate chunks', () => {
      // Multiple paragraphs under a heading — each paragraph is a block
      const paragraphs = Array.from({ length: 10 }, (_, i) => `Block ${i}: ${'word '.repeat(20)}`)
      const text = `## Big\n\n${paragraphs.join('\n\n')}`
      const chunks = chunkMarkdown(text, { size: 300, overlap: 50 })
      expect(chunks.length).toBeGreaterThan(1)
      for (const chunk of chunks) {
        expect(chunk.sectionPath).toEqual(['Big'])
        expect(chunk.headingText).toBe('Big')
      }
    })

    it('never splits a Markdown paragraph containing a link', () => {
      const longParagraph =
        'This is a long paragraph with many words. '.repeat(10) +
        'And here is a [very important link](https://example.com/some/long/path?query=value) at the end.'
      const text = `## Section\n\n${longParagraph}`
      const chunks = chunkMarkdown(text, { size: 300, overlap: 50 })
      // Single paragraph = single block = one chunk, never split
      expect(chunks).toHaveLength(1)
      // Link syntax must be fully intact
      expect(chunks[0]!.text).toContain('[very important link](https://example.com/some/long/path?query=value)')
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

    it('never partially splits Markdown paragraphs and preserves section context', () => {
      const paragraphs = [
        'First paragraph with some content here.',
        'Second paragraph with different content inside.',
        'Third paragraph that is also unique and distinct.',
        'Fourth paragraph to make things add up.',
      ]
      const text = `## MySection\n\n${paragraphs.join('\n\n')}`
      const chunks = chunkMarkdown(text, { size: 80, overlap: 0 })
      expect(chunks.length).toBeGreaterThan(1)

      // Every original paragraph must appear whole in exactly one chunk
      for (const para of paragraphs) {
        const matches = chunks.filter((c) => c.text.includes(para))
        expect(matches).toHaveLength(1)
      }
      // All chunks inherit the section context
      for (const chunk of chunks) {
        expect(chunk.sectionPath).toEqual(['MySection'])
        expect(chunk.headingText).toBe('MySection')
      }
    })

    it('handles GFM tables without throwing and preserves them', () => {
      // Regression: serializeBlocks() was missing remarkGfm, so table nodes
      // threw "Cannot handle unknown node `table`" during Markdown chunking.
      const text = `## Metrics

| Name | Value |
| --- | --- |
| Precision | 0.92 |
| Recall | 0.87 |`

      let chunks: ChunkData[] = []
      expect(() => {
        chunks = chunkMarkdown(text, { size: 500, overlap: 100 })
      }).not.toThrow()

      expect(chunks).toHaveLength(1)
      expect(chunks[0]!.sectionPath).toEqual(['Metrics'])
      // Table preserved (serialized compactly: tableCellPadding disabled)
      expect(chunks[0]!.text).toContain('|Name|Value|')
      expect(chunks[0]!.text).toContain('|Precision|0.92|')
      expect(chunks[0]!.text).toContain('|Recall|0.87|')
      // searchText keeps cell content without pipes
      expect(chunks[0]!.searchText).toContain('Precision')
      expect(chunks[0]!.searchText).toContain('0.92')
    })
  })
})
