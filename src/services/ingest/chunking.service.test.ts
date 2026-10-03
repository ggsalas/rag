import { describe, it, expect } from 'vitest'
import {
  chunkText,
  chunkMarkdown,
  extractOverlapText,
  type ChunkData,
} from './chunking.service'

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
      const paragraphs = Array.from(
        { length: 20 },
        (_, i) => `Paragraph ${i}: ${'word '.repeat(20)}`,
      )
      const text = paragraphs.join('\n\n')
      const chunks = chunkText(text, { size: 300, overlap: 50 })
      expect(chunks.length).toBeGreaterThan(1)
    })

    it('should not exceed size for well-separated paragraphs', () => {
      const paragraphs = Array.from(
        { length: 20 },
        (_, i) => `P${i}: ${'word '.repeat(10)}`,
      )
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

    it('splits oversized paragraphs by sentences to respect size limit', () => {
      // A long paragraph with multiple sentences is split to respect the size limit
      const longParagraph =
        'First sentence here. Second sentence here. Third sentence here. Fourth sentence here. Fifth sentence here.'
      const chunks = chunkText(longParagraph, { size: 100, overlap: 20 })
      // Should split into multiple chunks since the paragraph exceeds size
      expect(chunks.length).toBeGreaterThan(1)
      // All chunks should have non-empty searchText
      for (const chunk of chunks) {
        expect(chunk.searchText.trim().length).toBeGreaterThan(0)
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
      // Multiple paragraphs so chunking can split on paragraph boundaries
      const paragraphs = Array.from(
        { length: 50 },
        (_, i) => `P${i}: ${'word '.repeat(20)}`,
      )
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

    it('splits oversized Markdown blocks by sentences to respect size limit', () => {
      // A single long paragraph under a heading is split by sentences to respect size
      const sentences = Array.from(
        { length: 20 },
        (_, i) => `Sentence ${i} with some content.`,
      )
      const longParagraph = sentences.join(' ')
      const text = `## Big\n\n${longParagraph}`
      const chunks = chunkMarkdown(text, { size: 300, overlap: 50 })
      // Should split into multiple chunks since the paragraph exceeds size
      expect(chunks.length).toBeGreaterThan(1)
      // All chunks should inherit the section context
      for (const chunk of chunks) {
        expect(chunk.sectionPath).toEqual(['Big'])
        expect(chunk.headingText).toBe('Big')
      }
    })

    it('splits sections with multiple blocks into separate chunks', () => {
      // Multiple paragraphs under a heading — each paragraph is a block
      const paragraphs = Array.from(
        { length: 10 },
        (_, i) => `Block ${i}: ${'word '.repeat(20)}`,
      )
      const text = `## Big\n\n${paragraphs.join('\n\n')}`
      const chunks = chunkMarkdown(text, { size: 300, overlap: 50 })
      expect(chunks.length).toBeGreaterThan(1)
      for (const chunk of chunks) {
        expect(chunk.sectionPath).toEqual(['Big'])
        expect(chunk.headingText).toBe('Big')
      }
    })

    it('never breaks Markdown link syntax when splitting oversized paragraphs', () => {
      // WHY THE PREVIOUS TEST WAS VACUOUS:
      // The old test used regex `/\[(?=[^\]]*\]\()/g` which only counts `[` when
      // followed by `](` — i.e., it only counts WELL-FORMED links. When a link is
      // broken (e.g., `[text` in one chunk and `url)` in the next), the regex
      // returns 0 matches, so the assertion `expect(closeBrackets).toBe(openBrackets)`
      // becomes `expect(0).toBe(0)` and passes silently. The test never detected
      // the bug it was supposed to catch.
      //
      // Additionally, the old test's input had the link in a short sentence at the
      // end of a long paragraph. With size=300, that sentence never exceeded the
      // budget, so `splitOversizedUnit` was never called on it. The test never
      // exercised the code path that breaks links.
      //
      // THIS TEST:
      // - Uses a single long sentence (no .!?) to force the `splitIntoSentences`
      //   fallback path (whitespace splitting).
      // - Makes the link text long enough (~400 chars) that it spans multiple
      //   100-char grouping boundaries, guaranteeing the splitter will cut inside
      //   the link if it doesn't treat links as atomic.
      // - Asserts robustly: counts ALL `[` and ALL `](` in each chunk. A broken
      //   link produces mismatched counts (e.g., chunk 1 has `[` but no `](`,
      //   chunk 3 has `](` but no `[`).
      // - Verifies the full link appears intact in at least one chunk.

      const longLinkText = 'very '.repeat(80) + 'important hyperlink'
      const longSentence =
        'Some introductory filler text that goes on and on without any sentence boundary ' +
        `and eventually reaches a [${longLinkText}](https://example.com/some/path) ` +
        'which is followed by even more filler text to force the splitter to work hard ' +
        'and split the sentence at a whitespace somewhere inside the link or nearby'

      const text = `## Section\n\n${longSentence}`
      const chunks = chunkMarkdown(text, { size: 200, overlap: 0 })
      expect(chunks.length).toBeGreaterThan(1)

      // Robust broken-link detection: count ALL `[` and ALL `](` in each chunk.
      // A well-formed Markdown link contributes exactly one `[` and one `](`.
      // If a link is split across chunks, one chunk will have `[` without `](`
      // (the opening bracket) and another will have `](` without `[` (the closing
      // part). This catches the bug that the previous regex missed.
      for (const chunk of chunks) {
        const allOpenBrackets = (chunk.text.match(/\[/g) || []).length
        const linkTransitions = (chunk.text.match(/\]\(/g) || []).length
        expect(allOpenBrackets).toBe(linkTransitions)
      }

      // The full link must appear intact in at least one chunk
      const fullLink = `[${longLinkText}](https://example.com/some/path)`
      const linkFound = chunks.some((c) => c.text.includes(fullLink))
      expect(linkFound).toBe(true)
    })

    it('never breaks Markdown link syntax in overlap prefix', () => {
      // WHY THIS TEST IS NEEDED:
      // The overlap mechanism (`extractOverlapText`) takes the last N characters
      // of the previous chunk and prepends them to the next chunk. If the cut
      // position falls inside a Markdown link `[text](url)`, the overlap prefix
      // will contain a broken link fragment (e.g., `ki/Britney:_Piece_of_Me)`
      // which is the tail of a URL, or `](https://...)` without a preceding `[`).
      //
      // THIS TEST:
      // - Creates a paragraph with a link near the end, positioned so that the
      //   overlap cut (last 150 chars) falls inside the link.
      // - Uses overlap > 0 to exercise `extractOverlapText`.
      // - Verifies that no chunk has broken link syntax (unmatched `[` or `](`).
      // - Verifies that the overlap prefix (if present) doesn't start with a
      //   broken link fragment.

      // Create a paragraph where a link is positioned near the end, within the
      // overlap window (150 chars). The paragraph is long enough to force splitting.
      // The link text is long enough (>150 chars) that the overlap cut will fall
      // inside the link, not before it.
      const filler =
        'Some filler text that goes on for a while to make this paragraph long enough. '.repeat(
          8,
        )
      const longLinkText = 'very '.repeat(40) + 'important reference'
      const link = `[${longLinkText}](https://en.wikipedia.org/wiki/Some_Article)`
      const paragraph = `${filler} And here is an ${link} near the end of the paragraph.`

      const text = `## Section\n\n${paragraph}`
      const chunks = chunkMarkdown(text, { size: 500, overlap: 150 })

      // Should split into multiple chunks
      expect(chunks.length).toBeGreaterThan(1)

      // Verify no chunk has broken link syntax
      for (const chunk of chunks) {
        const allOpenBrackets = (chunk.text.match(/\[/g) || []).length
        const linkTransitions = (chunk.text.match(/\]\(/g) || []).length
        expect(allOpenBrackets).toBe(linkTransitions)
      }

      // Verify the full link appears intact in at least one chunk
      const linkFound = chunks.some((c) => c.text.includes(link))
      expect(linkFound).toBe(true)

      // Verify that if a chunk starts with overlap, it doesn't start with a
      // broken link fragment (e.g., `](url)` or a URL fragment ending in `)`)
      for (let i = 1; i < chunks.length; i++) {
        const chunk = chunks[i]!
        // Check if chunk starts with `](...)` without preceding `[`
        const startsWithBrokenLink =
          /^\s*\]\(/.test(chunk.text) ||
          /^[^\[]*\)\s/.test(chunk.text.slice(0, 50))
        expect(startsWithBrokenLink).toBe(false)
      }
    })

    it('never breaks Markdown link syntax in overlap when sentence boundary falls inside link', () => {
      // WHY THIS TEST IS NEEDED:
      // The overlap mechanism extracts the last N characters of the previous chunk,
      // then applies sentence boundary detection to find a clean start. If the
      // sentence boundary falls inside a Markdown link (e.g., at `bestseller. After`
      // within `[...bestseller. After starring](url)`), the overlap would start with
      // a broken link fragment like `After starring](url)`.
      //
      // THIS TEST uses the exact text from the Britney corpus that triggered the bug:
      // The link `[well as Britney (2001), her 21st-century bestseller. After starring]`
      // contains `bestseller. After` - a period followed by space. The old code would
      // detect this as a sentence boundary and return `After starring](url)` as the
      // overlap, breaking the link.
      //
      // IMPORTANT: The overlap window must be large enough that cutPos falls inside
      // the link text (before `bestseller. After`), not in the URL part after it.
      // With overlapChars=150, cutPos falls at position 317 (in the URL), which
      // doesn't exercise the bug. With overlapChars=202, cutPos falls at position
      // 265 (at the "b" in "bestseller"), which does exercise the bug.

      // This is the exact text from chunk 1 of the Britney corpus
      const prevChunkText = `Spears became the best-selling teenage artist of all time with the best-selling albums [*...Baby*](https://en.wikipedia.org/wiki/...Baby_One_More_Time_\\(album\\)) [*One More Time (1999) and Oops!... I Did It Again (2000), as well as Britney (2001), her 21st-century bestseller. After starring](https://en.wikipedia.org/wiki/List_of_best-selling_albums_of_the_21st_century) in the film Crossroads (2002), she released the albums In the _Zone (2003) and Blackout (2007).`

      // Extract overlap with a window that places cutPos inside the link text
      // (at the "b" in "bestseller", where the sentence boundary is)
      const overlap = extractOverlapText(prevChunkText, 202)

      // The overlap should NOT start with "After starring]("
      // which would indicate a broken link
      expect(overlap.startsWith('After starring](')).toBe(false)

      // The overlap should not contain unbalanced brackets
      const openBrackets = (overlap.match(/\[/g) || []).length
      const linkTransitions = (overlap.match(/\]\(/g) || []).length
      expect(openBrackets).toBe(linkTransitions)
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
      // Table preserved with original formatting (sliced from source, not re-serialized)
      expect(chunks[0]!.text).toContain('| Name | Value |')
      expect(chunks[0]!.text).toContain('| Precision | 0.92 |')
      expect(chunks[0]!.text).toContain('| Recall | 0.87 |')
      // searchText keeps cell content without pipes
      expect(chunks[0]!.searchText).toContain('Precision')
      expect(chunks[0]!.searchText).toContain('0.92')
    })

    it('never carries overlap across a heading boundary', () => {
      // Overlap must stay within one section — it must never include text
      // from a preceding section separated by a heading.
      // Both sections have oversized content to force multiple chunks with overlap.
      const longParagraphA = 'Sentence alpha. '.repeat(30) + 'Sentence alpha final.'
      const longParagraphB = 'Sentence beta. '.repeat(30) + 'Sentence beta final.'
      const text = `## Section A\n\n${longParagraphA}\n\n## Section B\n\n${longParagraphB}`

      const chunks = chunkMarkdown(text, { size: 300, overlap: 150 })
      expect(chunks.length).toBeGreaterThan(2)

      // Find chunks belonging to each section
      const sectionAChunks = chunks.filter((c) =>
        c.sectionPath.includes('Section A'),
      )
      const sectionBChunks = chunks.filter((c) =>
        c.sectionPath.includes('Section B'),
      )

      // Both sections should have multiple chunks (forcing overlap usage)
      expect(sectionAChunks.length).toBeGreaterThan(1)
      expect(sectionBChunks.length).toBeGreaterThan(1)

      // No Section B chunk should contain text from Section A's content
      for (const chunk of sectionBChunks) {
        // The overlap prefix should not contain Section A's unique text
        expect(chunk.text).not.toContain('Sentence alpha.')
        expect(chunk.text).not.toContain('alpha final')
      }

      // No Section A chunk should contain text from Section B's content
      for (const chunk of sectionAChunks) {
        expect(chunk.text).not.toContain('Sentence beta.')
        expect(chunk.text).not.toContain('beta final')
      }

      // Verify that Section B chunks DO have overlap (from within Section B)
      const sectionBWithOverlap = sectionBChunks.filter((c) =>
        c.text.includes('Sentence beta.'),
      )
      expect(sectionBWithOverlap.length).toBeGreaterThan(0)
    })

    it('works correctly on pre-normalized text (no inline markup)', () => {
      // Simulates input from the normalize-markdown pipeline:
      // headings preserved, inline markup already flattened
      const normalizedText = `# Introduction

This is the first paragraph about the topic.

## Methods

We used special techniques and tools.

## Results

The accuracy was 95 percent.`

      const chunks = chunkMarkdown(normalizedText, { size: 500, overlap: 100 })
      expect(chunks.length).toBe(3)

      // Each chunk has correct section context
      expect(chunks[0]!.sectionPath).toEqual(['Introduction'])
      expect(chunks[1]!.sectionPath).toEqual(['Introduction', 'Methods'])
      expect(chunks[2]!.sectionPath).toEqual(['Introduction', 'Results'])

      // Text is plain (no Markdown syntax since input was normalized)
      for (const chunk of chunks) {
        expect(chunk.text).not.toContain('**')
        expect(chunk.text).not.toContain('](')
      }
    })

    it('sourceStart/sourceEnd are valid offsets into the input text', () => {
      const text = `## Section

First paragraph here.

Second paragraph here.`

      const chunks = chunkMarkdown(text, { size: 500, overlap: 100 })
      expect(chunks.length).toBeGreaterThan(0)

      for (const chunk of chunks) {
        if (chunk.sourceStart !== undefined && chunk.sourceEnd !== undefined) {
          expect(chunk.sourceStart).toBeGreaterThanOrEqual(0)
          expect(chunk.sourceEnd).toBeGreaterThan(chunk.sourceStart)
          expect(chunk.sourceEnd).toBeLessThanOrEqual(text.length)
          // The sliced text from offsets should be contained in the chunk text
          const sliced = text.slice(chunk.sourceStart, chunk.sourceEnd)
          expect(chunk.text).toContain(sliced.trim().slice(0, 20))
        }
      }
    })
  })
})
