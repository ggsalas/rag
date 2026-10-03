import { describe, it, expect } from 'vitest'
import { flattenInlineMarkup } from './flatten-inline-markup.service'

describe('flattenInlineMarkup', () => {
  it('returns empty/whitespace input unchanged', () => {
    expect(flattenInlineMarkup('')).toBe('')
    expect(flattenInlineMarkup('   ')).toBe('   ')
  })

  it('preserves heading markers', () => {
    const input = '# Title\n\n## Subtitle\n\nContent.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('# Title')
    expect(out).toContain('## Subtitle')
    expect(out).toContain('Content.')
  })

  it('removes bold markers (**)', () => {
    const input = 'This is **bold text** in a sentence.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('bold text')
    expect(out).not.toContain('**')
  })

  it('removes italic markers (*)', () => {
    const input = 'This is *italic text* in a sentence.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('italic text')
    expect(out).not.toMatch(/(?<!\w)\*italic/)
  })

  it('removes italic markers (_)', () => {
    const input = 'This is _italic text_ in a sentence.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('italic text')
    expect(out).not.toContain('_italic')
  })

  it('removes underline markers (HTML <u> is not Markdown, but **bold** is)', () => {
    const input = 'Some ***bold and italic*** text.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('bold and italic')
    expect(out).not.toContain('***')
  })

  it('removes link URLs but preserves visible link labels', () => {
    const input =
      'See [the documentation](https://example.com/docs) for details.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('the documentation')
    expect(out).toContain('details')
    expect(out).not.toContain('https://example.com')
    expect(out).not.toContain('](')
  })

  it('preserves multiple link labels in the same paragraph', () => {
    const input =
      'Visit [Google](https://google.com) or [GitHub](https://github.com).'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('Google')
    expect(out).toContain('GitHub')
    expect(out).not.toContain('https://')
  })

  it('removes inline code backticks but preserves content', () => {
    const input = 'Use `npm install` to install.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('npm install')
    expect(out).not.toContain('`')
  })

  it('preserves paragraph boundaries', () => {
    const input = 'First paragraph.\n\nSecond paragraph.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('First paragraph.')
    expect(out).toContain('Second paragraph.')
    expect(out).toMatch(/First paragraph\.\n\nSecond paragraph\./)
  })

  it('preserves list structure', () => {
    const input = '- Item one\n- Item two\n- Item three'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('- Item one')
    expect(out).toContain('- Item two')
    expect(out).toContain('- Item three')
  })

  it('preserves table structure', () => {
    const input = `| Col1 | Col2 |
| --- | --- |
| A | B |`
    const out = flattenInlineMarkup(input)
    expect(out).toContain('Col1')
    expect(out).toContain('Col2')
    expect(out).toContain('|')
  })

  it('preserves code block content', () => {
    const input = '```js\nconst x = 1\n```'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('const x = 1')
  })

  it('handles nested inline markup', () => {
    const input =
      'Read the **[official docs](https://example.com)** for *more* info.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('official docs')
    expect(out).toContain('more')
    expect(out).not.toContain('**')
    expect(out).not.toContain('https://example.com')
  })

  it('preserves strikethrough text without markers', () => {
    const input = 'This is ~~deleted~~ text.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('deleted')
    expect(out).not.toContain('~~')
  })

  it('handles complex document with headings, links, and formatting', () => {
    const input = `# Introduction

This is the **first** paragraph with a [link](https://example.com).

## Methods

We used _special_ techniques and \`code snippets\`.

- Item with **bold**
- Item with [reference](https://ref.com)

## Results

| Metric | Value |
| --- | --- |
| Accuracy | **95%** |`

    const out = flattenInlineMarkup(input)

    // Headings preserved
    expect(out).toContain('# Introduction')
    expect(out).toContain('## Methods')
    expect(out).toContain('## Results')

    // Inline markup removed
    expect(out).not.toContain('**first**')
    expect(out).toContain('first')
    expect(out).not.toContain('_special_')
    expect(out).toContain('special')
    expect(out).not.toContain('`code snippets`')
    expect(out).toContain('code snippets')

    // Link URLs removed, labels kept
    expect(out).not.toContain('https://example.com')
    expect(out).toContain('link')
    expect(out).not.toContain('https://ref.com')
    expect(out).toContain('reference')

    // Structure preserved
    expect(out).toContain('- Item with bold')
    expect(out).toContain('|')
  })

  it('strips HTML underline tags <u>', () => {
    const input = 'This has <u>underlined text</u> inside.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('underlined text')
    expect(out).not.toContain('<u>')
    expect(out).not.toContain('</u>')
  })

  it('strips HTML bold tags <b> and <strong>', () => {
    const input = 'This has <b>bold</b> and <strong>strong</strong> text.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('bold')
    expect(out).toContain('strong')
    expect(out).not.toContain('<b>')
    expect(out).not.toContain('</b>')
    expect(out).not.toContain('<strong>')
    expect(out).not.toContain('</strong>')
  })

  it('strips HTML italic tags <i> and <em>', () => {
    const input = 'This has <i>italic</i> and <em>emphasized</em> text.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('italic')
    expect(out).toContain('emphasized')
    expect(out).not.toContain('<i>')
    expect(out).not.toContain('</i>')
    expect(out).not.toContain('<em>')
    expect(out).not.toContain('</em>')
  })

  it('strips HTML strikethrough tags <s> and <del>', () => {
    const input = 'This has <s>strike</s> and <del>deleted</del> text.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('strike')
    expect(out).toContain('deleted')
    expect(out).not.toContain('<s>')
    expect(out).not.toContain('</s>')
    expect(out).not.toContain('<del>')
    expect(out).not.toContain('</del>')
  })

  it('strips HTML highlight tag <mark>', () => {
    const input = 'This has <mark>highlighted</mark> text.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('highlighted')
    expect(out).not.toContain('<mark>')
    expect(out).not.toContain('</mark>')
  })

  it('strips HTML tags with attributes', () => {
    const input = 'This has <u style="color:red">styled underline</u>.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('styled underline')
    expect(out).not.toContain('<u')
    expect(out).not.toContain('</u>')
    expect(out).not.toContain('style=')
  })

  it('handles mixed Markdown and HTML inline formatting', () => {
    const input = 'This has **bold**, <u>underline</u>, and *italic* together.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('bold')
    expect(out).toContain('underline')
    expect(out).toContain('italic')
    expect(out).not.toContain('**')
    expect(out).not.toContain('<u>')
    expect(out).not.toContain('*')
  })

  // ── Citation stripping ───────────────────────────────────────────────

  it('removes numeric citation markers from text', () => {
    const input = 'The language was created in 1972.[6] It is widely used.[10]'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('created in 1972.')
    expect(out).toContain('widely used.')
    // remark-stringify would escape remaining brackets; citations are gone
    expect(out).not.toContain('[6]')
    expect(out).not.toContain('\\[6]')
    expect(out).not.toContain('[10]')
    expect(out).not.toContain('\\[10]')
  })

  it('removes range and list citation markers like [1, 2, 3] and [1-3]', () => {
    const input = 'See also.[1, 2, 3] And more.[1-3]'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('See also.')
    expect(out).toContain('And more.')
    expect(out).not.toContain('[1, 2, 3]')
    expect(out).not.toContain('[1-3]')
  })

  it('removes single-letter citation markers like [a] and [b]', () => {
    const input = 'Some claim.[a] Another claim.[b]'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('Some claim.')
    expect(out).toContain('Another claim.')
    expect(out).not.toContain('[a]')
    expect(out).not.toContain('\\[a]')
    expect(out).not.toContain('[b]')
    expect(out).not.toContain('\\[b]')
  })

  it('removes escaped citation markers after remark normalisation', () => {
    // In Markdown, \[a\] and \[6\] are escaped brackets.
    // remark-parse normalises them to [a] and [6] in text nodes,
    // so our citation stripper removes them before re-serialisation.
    const input = 'A claim\\[a\\] and a reference\\[6\\].'
    const out = flattenInlineMarkup(input)
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
    const out = flattenInlineMarkup(input)
    // Meaningful brackets are preserved (remark-stringify escapes the opening [)
    expect(out).toContain('C++')
    expect(out).toContain('API')
    expect(out).toContain('Node.js')
    expect(out).toContain('foo bar')
    // They should NOT be stripped — check the escaped form that remark produces
    expect(out).toContain('\\[C++]')
    expect(out).toContain('\\[API]')
    expect(out).toContain('\\[Node.js]')
    expect(out).toContain('\\[foo bar]')
  })

  it('does not strip citations inside fenced code blocks', () => {
    const input = '```\nconst ref = [1];\nconst x = [a];\n```'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('[1]')
    expect(out).toContain('[a]')
  })

  it('does not strip citations inside inline code', () => {
    const input = 'Use `arr[0]` and `map[key]` to access.'
    const out = flattenInlineMarkup(input)
    // Inline code brackets are preserved (remark-stringify escapes the opening [)
    // The key assertion: citation-like patterns inside code are NOT removed
    expect(out).toContain('arr')
    expect(out).toContain('0')
    expect(out).toContain('map')
    expect(out).toContain('key')
    // remark-stringify escapes [ in text nodes, so we see \[ in output
    expect(out).toContain('arr\\[0]')
    expect(out).toContain('map\\[key]')
  })

  it('strips citations from link labels', () => {
    const input =
      'Read [the specification [1]](https://example.com) for details.'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('the specification')
    expect(out).toContain('details')
    expect(out).not.toContain('https://example.com')
    expect(out).not.toContain('[1]')
    expect(out).not.toContain('\\[1]')
  })

  it('handles Wikipedia-style paragraph with mixed citations and links', () => {
    const input =
      '**JavaScript (JS)** \\[a] [is a programming language](https://example.com) created in 1995.\\[6\\]'
    const out = flattenInlineMarkup(input)
    expect(out).toContain('JavaScript (JS)')
    expect(out).toContain('is a programming language')
    expect(out).toContain('created in 1995.')
    expect(out).not.toContain('[a]')
    expect(out).not.toContain('\\[a]')
    expect(out).not.toContain('[6]')
    expect(out).not.toContain('\\[6]')
    expect(out).not.toContain('https://example.com')
  })
})
