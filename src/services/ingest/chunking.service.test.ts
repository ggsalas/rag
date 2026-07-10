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

  describe('chunkMarkdown', () => {
    it('keeps each heading section as one chunk when it fits', () => {
      const text = `## Intro\n\nShort intro paragraph.\n\n## Body\n\nShort body paragraph.`
      const chunks = chunkMarkdown(text, { size: 500, overlap: 100 })
      expect(chunks).toHaveLength(2)
      expect(chunks[0]!.text).toContain('## Intro')
      expect(chunks[1]!.text).toContain('## Body')
    })

    it('splits oversized sections via paragraph chunking', () => {
      const text = `## Big\n\n${'word '.repeat(300)}`
      const chunks = chunkMarkdown(text, { size: 300, overlap: 50 })
      expect(chunks.length).toBeGreaterThan(1)
    })

    it('assigns sequential chunkIndex', () => {
      const text = `## A\n\nOne.\n\n## B\n\nTwo.\n\n## C\n\nThree.`
      const chunks = chunkMarkdown(text, { size: 500, overlap: 100 })
      chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i))
    })

    it('populates headingText and sectionPath for each chunk', () => {
      const text = `# Doc\n\n## Intro\n\nHello.\n\n## Body\n\nWorld.`
      const chunks = chunkMarkdown(text, { size: 500, overlap: 100 })
      const intro = chunks.find((c) => c.headingText === 'Intro')!
      const body = chunks.find((c) => c.headingText === 'Body')!
      expect(intro.sectionPath).toEqual(['Doc', 'Intro'])
      expect(body.sectionPath).toEqual(['Doc', 'Body'])
    })

    it('resets sibling subsections when a new parent heading appears (no cross-chapter leak)', () => {
      const text = [
        '# Book',
        '## Chapter A',
        '### Section 1',
        'A1 content.',
        '### Section 2',
        'A2 content.',
        '## Chapter B',
        '### Section 1',
        'B1 content.',
      ].join('\n\n')
      const chunks = chunkMarkdown(text, { size: 500, overlap: 100 })

      const a2 = chunks.find((c) => c.text.includes('A2 content.'))!
      const b1 = chunks.find((c) => c.text.includes('B1 content.'))!

      // A2 lives under Chapter A, B1 lives under Chapter B — cross-chapter
      // contamination would put B1 under Chapter A here.
      expect(a2.sectionPath).toEqual(['Book', 'Chapter A', 'Section 2'])
      expect(b1.sectionPath).toEqual(['Book', 'Chapter B', 'Section 1'])
      expect(a2.headingText).toBe('Section 2')
      expect(b1.headingText).toBe('Section 1')
    })

    it('prepends the immediate heading to every sub-chunk of an oversized section', () => {
      const text = `## Discography\n\n${'album '.repeat(300)}`
      const chunks = chunkMarkdown(text, { size: 300, overlap: 50 })
      expect(chunks.length).toBeGreaterThan(1)
      for (const c of chunks) {
        expect(c.text.startsWith('## Discography')).toBe(true)
        expect(c.headingText).toBe('Discography')
        expect(c.sectionPath).toEqual(['Discography'])
      }
    })

    it('never emits an orphan chunk containing only the heading', () => {
      const text = `## Discography\n\n${'album '.repeat(300)}`
      const chunks = chunkMarkdown(text, { size: 300, overlap: 50 })
      // Every chunk must have body content, not just the heading line.
      for (const c of chunks) {
        const bodyAfterHeading = c.text.replace(/^## [^\n]*\n\n?/, '').trim()
        expect(bodyAfterHeading.length).toBeGreaterThan(0)
      }
    })

    it('handles preamble text before the first heading', () => {
      const text = `Preface paragraph.\n\n## First\n\nBody.`
      const chunks = chunkMarkdown(text, { size: 500, overlap: 100 })
      const preamble = chunks.find((c) => c.text.includes('Preface'))
      const first = chunks.find((c) => c.headingText === 'First')
      expect(preamble).toBeDefined()
      expect(preamble!.headingText).toBe('')
      expect(preamble!.sectionPath).toEqual([])
      expect(first).toBeDefined()
      expect(first!.sectionPath).toEqual(['First'])
    })

    it('handles level jumps without leaving empty slots', () => {
      const text = `# Root\n\n### Deep\n\nSkipped level 2.`
      const chunks = chunkMarkdown(text, { size: 500, overlap: 100 })
      const deep = chunks.find((c) => c.headingText === 'Deep')!
      // The H2 slot is empty — filter it out; sectionPath stays contiguous.
      expect(deep.sectionPath).toEqual(['Root', 'Deep'])
    })
  })
})
