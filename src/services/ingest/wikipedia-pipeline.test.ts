/**
 * Regression test for Wikipedia PDF ingestion pipeline.
 * Tests the full pipeline: sanitize → filter → chunk → searchText
 */

import { describe, it, expect } from 'vitest'
import { sanitize } from './sanitize.service'
import { filterBoilerplateSections } from './section-filter.service'
import { chunkMarkdown } from './chunking.service'

describe('Wikipedia PDF ingestion pipeline', () => {
  const wikipediaMarkdown = `# Albert Einstein

Albert Einstein (14 March 1879 – 18 April 1955) was a German-born theoretical physicist.

## Early life

Einstein was born in Ulm, in the Kingdom of Württemberg in the German Empire.

## Career

He developed the theory of relativity, one of the two pillars of modern physics.

### Special relativity

In 1905, he published the special theory of relativity.

### General relativity

In 1915, he published the general theory of relativity.

## Personal life

Einstein married Mileva Marić in 1903. They had three children together.

## References [edit]

1. ^ Einstein, Albert (1905). "On the Electrodynamics of Moving Bodies". Annalen der Physik.
2. ^ Einstein, Albert (1915). "The Foundation of the General Theory of Relativity".
3. ^ Pais, Abraham (1982). Subtle is the Lord: The Science and the Life of Albert Einstein.

## Further reading {#further-reading}

- Clark, Ronald W. (1971). Einstein: The Life and Times. Avon Books.
- Isaacson, Walter (2007). Einstein: His Life and Universe. Simon & Schuster.

## External links [edit]

- [Albert Einstein at Encyclopædia Britannica](https://www.britannica.com/biography/Albert-Einstein)
- [Einstein Archives Online](https://www.alberteinstein.info/)
- [Nobel Prize in Physics 1921](https://www.nobelprize.org/nobel_prizes/physics/laureates/1921/)
`

  it('processes Wikipedia-style PDF through full pipeline', () => {
    // Step 1: Sanitize
    const sanitized = sanitize(wikipediaMarkdown)
    expect(sanitized).toBeTruthy()
    expect(sanitized.length).toBeGreaterThan(0)

    // Step 2: Filter boilerplate sections
    const filtered = filterBoilerplateSections(sanitized, {
      enableHeuristic: true,
    })
    expect(filtered).toBeTruthy()
    expect(filtered.length).toBeGreaterThan(0)

    // Boilerplate sections should be removed
    expect(filtered).not.toContain('References [edit]')
    expect(filtered).not.toContain('Further reading {#further-reading}')
    expect(filtered).not.toContain('External links [edit]')

    // Main content should be preserved
    expect(filtered).toContain('Albert Einstein')
    expect(filtered).toContain('Early life')
    expect(filtered).toContain('Career')
    expect(filtered).toContain('Special relativity')
    expect(filtered).toContain('General relativity')
    expect(filtered).toContain('Personal life')

    // Step 3: Chunk markdown
    const chunks = chunkMarkdown(filtered)
    expect(chunks.length).toBeGreaterThan(0)

    // Each chunk should have required fields
    for (const chunk of chunks) {
      expect(chunk.text).toBeTruthy()
      expect(chunk.searchText).toBeTruthy()
      expect(chunk.sectionPath).toBeDefined()
      expect(chunk.headingText).toBeDefined()
      expect(chunk.chunkIndex).toBeGreaterThanOrEqual(0)

      // searchText should be plain text (no markdown syntax)
      expect(chunk.searchText).not.toMatch(/^#+\s/)
      expect(chunk.searchText).not.toContain('**')
      expect(chunk.searchText).not.toContain('*')
    }

    // Verify section paths are correct
    const earlyLifeChunk = chunks.find((c) =>
      c.sectionPath.includes('Early life'),
    )
    expect(earlyLifeChunk).toBeDefined()
    expect(earlyLifeChunk!.text).toContain('born in Ulm')

    const specialRelativityChunk = chunks.find((c) =>
      c.sectionPath.includes('Special relativity'),
    )
    expect(specialRelativityChunk).toBeDefined()
    expect(specialRelativityChunk!.sectionPath).toEqual([
      'Albert Einstein',
      'Career',
      'Special relativity',
    ])
  })

  it('strips Wikipedia citation markers [a], [6], [10] from searchText while preserving prose', () => {
    // Exact lead paragraph from a Wikipedia PDF export of the JavaScript article
    const paragraph = `**JavaScript (JS)** \\[a] [is a programming language and](https://en.wikipedia.org/wiki/Programming_language) [core technology of the Web, alongside HTML and](https://en.wikipedia.org/wiki/World_Wide_Web) [CSS. Created by Brendan Eich in 1995,\\[6\\]](https://en.wikipedia.org/wiki/Brendan_Eich) it is [maintained by Ecma International's TC39 technical](https://en.wikipedia.org/wiki/Ecma_International) committee,\\[10]`

    const sanitized = sanitize(paragraph)
    const filtered = filterBoilerplateSections(sanitized, {
      enableHeuristic: true,
    })
    const chunks = chunkMarkdown(filtered)

    expect(chunks.length).toBe(1)
    const firstChunk = chunks[0]
    expect(firstChunk).toBeDefined()
    const { searchText } = firstChunk!

    // Citation markers must be removed (raw, escaped, and link-wrapped forms)
    expect(searchText).not.toContain('[a]')
    expect(searchText).not.toContain('[6]')
    expect(searchText).not.toContain('[10]')
    expect(searchText).not.toContain('\\[')

    // Prose fully preserved: strong markers and link URLs unwrapped
    expect(searchText).toBe(
      "JavaScript (JS) is a programming language and core technology of the Web, alongside HTML and CSS. Created by Brendan Eich in 1995, it is maintained by Ecma International's TC39 technical committee,",
    )
  })

  it('handles empty document after filtering', () => {
    const onlyBoilerplate = `# References [edit]

1. Reference 1
2. Reference 2

## Bibliography [edit]

- Book 1
- Book 2`

    const sanitized = sanitize(onlyBoilerplate)
    const filtered = filterBoilerplateSections(sanitized, {
      enableHeuristic: true,
    })

    // After filtering, should be empty or near-empty
    const chunks = chunkMarkdown(filtered)
    expect(chunks.length).toBe(0)
  })

  it('handles document with no headings', () => {
    const noHeadings = `This is a paragraph without any headings.

This is another paragraph.

And a third one.`

    const sanitized = sanitize(noHeadings)
    const filtered = filterBoilerplateSections(sanitized, {
      enableHeuristic: true,
    })
    const chunks = chunkMarkdown(filtered)

    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(chunk.sectionPath).toEqual([])
      expect(chunk.headingText).toBe('')
    }
  })
})
