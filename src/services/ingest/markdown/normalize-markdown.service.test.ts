import { describe, it, expect } from 'vitest'
import { normalizeMarkdown } from './normalize-markdown.service'

describe('normalizeMarkdown', () => {
  it('returns empty/whitespace input unchanged', () => {
    expect(normalizeMarkdown('')).toBe('')
    expect(normalizeMarkdown('   ')).toBe('   ')
  })

  it('preserves heading hierarchy', () => {
    const input = `# Title

Content.

## Section A

Content A.

### Subsection

Deep content.

## Section B

Content B.`

    const out = normalizeMarkdown(input)
    expect(out).toContain('# Title')
    expect(out).toContain('## Section A')
    expect(out).toContain('### Subsection')
    expect(out).toContain('## Section B')
  })

  it('removes bold/italic markers while preserving text', () => {
    const input = 'This is **bold** and *italic* and ***both***.'
    const out = normalizeMarkdown(input)
    expect(out).toContain('bold')
    expect(out).toContain('italic')
    expect(out).toContain('both')
    expect(out).not.toContain('**')
  })

  it('removes link URLs but preserves visible labels', () => {
    const input = 'See [the docs](https://example.com/docs) for details.'
    const out = normalizeMarkdown(input)
    expect(out).toContain('the docs')
    expect(out).toContain('details')
    expect(out).not.toContain('https://example.com')
    expect(out).not.toContain('](')
  })

  it('filters References section', () => {
    const input = `# Article

Content.

## References

1. Author A, "Title", 2023`

    const out = normalizeMarkdown(input)
    expect(out).toContain('Article')
    expect(out).toContain('Content')
    expect(out).not.toContain('References')
    expect(out).not.toContain('Author A')
  })

  it('applies full pipeline: sanitize → filter → flatten', () => {
    const input = `# Introduction

This is the **first** paragraph with a [link](https://example.com).

## Methods

We used _special_ techniques.

## References

1. Author A`

    const out = normalizeMarkdown(input)

    // Headings preserved
    expect(out).toContain('# Introduction')
    expect(out).toContain('## Methods')

    // Inline markup removed
    expect(out).toContain('first')
    expect(out).not.toContain('**first**')
    expect(out).toContain('special')
    expect(out).not.toContain('_special_')

    // Link URL removed, label kept
    expect(out).toContain('link')
    expect(out).not.toContain('https://example.com')

    // Boilerplate removed
    expect(out).not.toContain('References')
    expect(out).not.toContain('Author A')
  })

  it('preserves list and table structure', () => {
    const input = `## Lists

- Item one
- Item two

## Tables

| Col1 | Col2 |
| --- | --- |
| A | B |`

    const out = normalizeMarkdown(input)
    expect(out).toContain('- Item one')
    expect(out).toContain('- Item two')
    expect(out).toContain('|')
    expect(out).toContain('Col1')
  })

  it('preserves code block content', () => {
    const input = `## Code

\`\`\`js
const x = 1
\`\`\``

    const out = normalizeMarkdown(input)
    expect(out).toContain('const x = 1')
  })

  // ── Citation stripping through the full pipeline ─────────────────────

  it('removes numeric citation markers from normalised output', () => {
    const input = 'The language was created in 1972.[6] It is widely used.[10]'
    const out = normalizeMarkdown(input)
    expect(out).toContain('created in 1972.')
    expect(out).toContain('widely used.')
    expect(out).not.toContain('[6]')
    expect(out).not.toContain('\\[6]')
    expect(out).not.toContain('[10]')
    expect(out).not.toContain('\\[10]')
  })

  it('removes letter and list citation markers', () => {
    const input = 'A claim.[a] See also.[1, 2, 3] And.[b]'
    const out = normalizeMarkdown(input)
    expect(out).toContain('A claim.')
    expect(out).toContain('See also.')
    expect(out).toContain('And.')
    expect(out).not.toContain('[a]')
    expect(out).not.toContain('[b]')
    expect(out).not.toContain('[1, 2, 3]')
  })

  it('removes escaped citation markers after remark normalisation', () => {
    const input = 'A claim\\[a\\] and a reference\\[6\\].'
    const out = normalizeMarkdown(input)
    expect(out).toContain('A claim')
    expect(out).toContain('and a reference')
    expect(out).not.toContain('[a]')
    expect(out).not.toContain('\\[a]')
    expect(out).not.toContain('[6]')
    expect(out).not.toContain('\\[6]')
  })

  it('preserves meaningful bracketed content like [C++] or [API]', () => {
    const input =
      'We use [C++] for performance and [API] for integration. Also [Node.js] and [foo bar].'
    const out = normalizeMarkdown(input)
    expect(out).toContain('C++')
    expect(out).toContain('API')
    expect(out).toContain('Node.js')
    expect(out).toContain('foo bar')
  })

  it('does not strip citations inside fenced code blocks', () => {
    const input = `## Code

\`\`\`
const ref = [1];
const x = [a];
\`\`\``
    const out = normalizeMarkdown(input)
    expect(out).toContain('[1]')
    expect(out).toContain('[a]')
  })
})
