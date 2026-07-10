import { describe, it, expect } from 'vitest'
import { sanitize } from './sanitize.service'

describe('sanitize (conservative)', () => {
  it('returns empty string unchanged', () => {
    expect(sanitize('')).toBe('')
  })

  it('normalizes NFKC ligatures (ﬁ → fi)', () => {
    // U+FB01 = ﬁ, U+FB02 = ﬂ
    const input = 'The ﬁnal ﬂower.'
    expect(sanitize(input)).toContain('final')
    expect(sanitize(input)).toContain('flower')
  })

  it('converts full-width characters to half-width via NFKC', () => {
    // Full-width "Hello 123" (each char is different codepoint)
    const input = 'Ｈｅｌｌｏ　１２３'
    const out = sanitize(input)
    expect(out).toContain('Hello')
    expect(out).toContain('123')
  })

  it('strips zero-width characters', () => {
    // ZWSP (U+200B), ZWNJ (U+200C), ZWJ (U+200D), BOM (U+FEFF)
    const input = 'a​b‌c‍d﻿e'
    expect(sanitize(input)).toBe('abcde')
  })

  it('converts NBSP to regular space', () => {
    // U+00A0 non-breaking space between "foo" and "bar"
    const input = 'foo bar'
    expect(sanitize(input)).toBe('foo bar')
  })

  it('preserves ATX headings', () => {
    const input = '## Section title\n\nBody paragraph.'
    expect(sanitize(input)).toContain('## Section title')
  })

  it('preserves bullet lists', () => {
    const input = '- item one\n- item two\n- item three'
    const out = sanitize(input)
    expect(out).toContain('- item one')
    expect(out).toContain('- item two')
  })

  it('preserves inline code content verbatim', () => {
    // Two internal spaces inside inline code must survive whitespace collapse.
    const input = 'Use `foo  bar` to run.'
    expect(sanitize(input)).toContain('`foo  bar`')
  })

  it('preserves fenced code blocks verbatim', () => {
    const input = '```md\n[link](url)  double  space\n```'
    const out = sanitize(input)
    // The link markdown inside the code fence must NOT be unwrapped
    expect(out).toContain('[link](url)')
    // Internal double spaces preserved
    expect(out).toContain('double  space')
  })

  it('unwraps markdown links, keeping the label and dropping the URL', () => {
    // URLs are metadata, not human content; leaving them embedded pollutes
    // BM25 tokenization and vector embeddings.
    const input = 'See [the article](https://example.com) for details.'
    const out = sanitize(input)
    expect(out).toContain('the article')
    expect(out).toContain('for details.')
    expect(out).not.toContain('https://example.com')
    expect(out).not.toContain('](')
  })

  it('unwraps reference-style links', () => {
    const input =
      'See [the article][ref] for details.\n\n[ref]: https://example.com'
    const out = sanitize(input)
    expect(out).toContain('the article')
    expect(out).not.toContain('[ref]')
  })

  it('preserves markdown tables including empty rows', () => {
    const input = `| col1 | col2 |
| --- | --- |
| a | b |
|   |   |
| c | d |`
    const out = sanitize(input)
    expect(out).toContain('col1')
    expect(out).toContain('col2')
    expect(out).toContain('|a|b|')
    expect(out).toContain('|c|d|')
    // The all-blank row structure survives
    expect(out.split('\n').filter((l) => l.includes('|')).length).toBeGreaterThanOrEqual(4)
  })

  it('collapses whitespace in regular text nodes', () => {
    // Double spaces inside a paragraph should collapse to single spaces.
    const input = 'foo   bar    baz.'
    expect(sanitize(input)).toBe('foo bar baz.')
  })

  it('preserves paragraph structure with a single blank line between blocks', () => {
    const input = 'First paragraph.\n\nSecond paragraph.'
    const out = sanitize(input)
    expect(out).toContain('First paragraph.')
    expect(out).toContain('Second paragraph.')
    expect(out).toMatch(/First paragraph\.\n\nSecond paragraph\./)
  })

  it('is idempotent', () => {
    const input = `## Heading

A paragraph with a [link](https://x.com) and \`inline code\`.

- item one
- item two

\`\`\`js
const x = 1
\`\`\``
    const once = sanitize(input)
    const twice = sanitize(once)
    expect(twice).toBe(once)
  })
})
