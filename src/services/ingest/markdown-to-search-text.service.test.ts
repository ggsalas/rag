import { describe, it, expect } from 'vitest'
import { markdownToSearchText } from './markdown-to-search-text.service'

describe('markdownToSearchText', () => {
  it('returns empty string for empty input', () => {
    expect(markdownToSearchText('')).toBe('')
    expect(markdownToSearchText('   ')).toBe('')
  })

  it('extracts heading text without # markers', () => {
    const input = '# Main Title\n\n## Subtitle\n\nContent.'
    const out = markdownToSearchText(input)
    expect(out).toContain('Main Title')
    expect(out).toContain('Subtitle')
    expect(out).not.toContain('#')
  })

  it('preserves emphasis and strong text without markers', () => {
    const input = 'This is *italic* and **bold** and ***both***.'
    const out = markdownToSearchText(input)
    expect(out).toContain('italic')
    expect(out).toContain('bold')
    expect(out).toContain('both')
    expect(out).not.toContain('*')
  })

  it('preserves link text but removes URLs', () => {
    const input =
      'See [the documentation](https://example.com/docs) for details.'
    const out = markdownToSearchText(input)
    expect(out).toContain('the documentation')
    expect(out).toContain('details')
    expect(out).not.toContain('https://example.com')
    expect(out).not.toContain('[')
    expect(out).not.toContain('](')
  })

  it('omits images by default', () => {
    const input = 'Text before. ![Alt text](image.png) Text after.'
    const out = markdownToSearchText(input)
    expect(out).toContain('Text before')
    expect(out).toContain('Text after')
    // Alt text is preserved if meaningful
    expect(out).toContain('Alt text')
    expect(out).not.toContain('image.png')
  })

  it('preserves list item text without markers', () => {
    const input = '- Item one\n- Item two\n  - Nested item'
    const out = markdownToSearchText(input)
    expect(out).toContain('Item one')
    expect(out).toContain('Item two')
    expect(out).toContain('Nested item')
    expect(out).not.toMatch(/^-\s/m) // No list markers at line start
  })

  it('preserves table cell content', () => {
    const input = `| Column 1 | Column 2 |
| --- | --- |
| Cell A | Cell B |
| Cell C | Cell D |`
    const out = markdownToSearchText(input)
    expect(out).toContain('Column 1')
    expect(out).toContain('Column 2')
    expect(out).toContain('Cell A')
    expect(out).toContain('Cell B')
    expect(out).toContain('Cell C')
    expect(out).toContain('Cell D')
    expect(out).not.toContain('|') // No pipe characters
  })

  it('preserves code block content without fences', () => {
    const input = '```js\nconst x = 1\nconsole.log(x)\n```'
    const out = markdownToSearchText(input)
    expect(out).toContain('const x = 1')
    expect(out).toContain('console.log(x)')
    expect(out).not.toContain('```')
  })

  it('preserves inline code without backticks', () => {
    const input = 'Use `npm install` to install.'
    const out = markdownToSearchText(input)
    expect(out).toContain('npm install')
    expect(out).not.toContain('`')
  })

  it('normalizes whitespace', () => {
    const input =
      'Text   with    multiple     spaces.\n\n\n\nMultiple blank lines.'
    const out = markdownToSearchText(input)
    expect(out).not.toContain('   ') // No triple spaces
    expect(out).not.toContain('\n\n\n') // No triple newlines
  })

  it('handles complex nested structures', () => {
    const input = `# Title

A paragraph with **bold**, *italic*, and a [link](https://example.com).

## Section

- List item with \`code\`
- Another item

| Header |
| --- |
| Data |

\`\`\`python
def foo():
    return 42
\`\`\`
`
    const out = markdownToSearchText(input)

    // All visible text preserved
    expect(out).toContain('Title')
    expect(out).toContain('bold')
    expect(out).toContain('italic')
    expect(out).toContain('link')
    expect(out).toContain('Section')
    expect(out).toContain('List item')
    expect(out).toContain('code')
    expect(out).toContain('Header')
    expect(out).toContain('Data')
    expect(out).toContain('def foo')
    expect(out).toContain('return 42')

    // No Markdown syntax
    expect(out).not.toContain('#')
    expect(out).not.toContain('**')
    expect(out).not.toContain('*')
    expect(out).not.toContain('[')
    expect(out).not.toContain('](')
    expect(out).not.toContain('`')
    expect(out).not.toContain('|')
    expect(out).not.toContain('```')
  })

  it('handles empty table cells', () => {
    const input = `| Col1 | Col2 |
| --- | --- |
| A |  |
|  | B |`
    const out = markdownToSearchText(input)
    expect(out).toContain('Col1')
    expect(out).toContain('Col2')
    expect(out).toContain('A')
    expect(out).toContain('B')
  })

  it('preserves strikethrough text', () => {
    const input = 'This is ~~deleted~~ text.'
    const out = markdownToSearchText(input)
    expect(out).toContain('deleted')
    expect(out).not.toContain('~~')
  })

  it('handles blockquotes', () => {
    const input = '> This is a quote.\n> With multiple lines.'
    const out = markdownToSearchText(input)
    expect(out).toContain('This is a quote')
    expect(out).toContain('With multiple lines')
    expect(out).not.toContain('>')
  })

  it('removes Wikipedia-style numeric citation markers', () => {
    const input =
      'The language was created in 1972.[6] It is widely used.[10] See also.[1, 2, 3]'
    const out = markdownToSearchText(input)
    expect(out).toContain('The language was created in 1972.')
    expect(out).toContain('It is widely used.')
    expect(out).toContain('See also.')
    expect(out).not.toContain('[6]')
    expect(out).not.toContain('[10]')
    expect(out).not.toContain('[1, 2, 3]')
  })

  it('removes single-letter citation markers like [a] or [b]', () => {
    const input = 'Some claim.[a] Another claim.[b]'
    const out = markdownToSearchText(input)
    expect(out).toContain('Some claim.')
    expect(out).toContain('Another claim.')
    expect(out).not.toContain('[a]')
    expect(out).not.toContain('[b]')
  })

  it('removes escaped citation markers (normalized by remark)', () => {
    // In Markdown, \[a\] and \[6\] are escaped brackets.
    // remark normalizes them to [a] and [6] in text nodes,
    // so our citation stripper should still remove them.
    const input = 'A claim\\[a\\] and a reference\\[6\\].'
    const out = markdownToSearchText(input)
    expect(out).toContain('A claim')
    expect(out).toContain('and a reference')
    expect(out).not.toContain('[a]')
    expect(out).not.toContain('[6]')
  })

  it('preserves meaningful bracketed content like [C++] or [API]', () => {
    const input =
      'We use [C++] for performance and [API] for integration. Also [Node.js] and [foo bar].'
    const out = markdownToSearchText(input)
    expect(out).toContain('[C++]')
    expect(out).toContain('[API]')
    expect(out).toContain('[Node.js]')
    expect(out).toContain('[foo bar]')
  })

  it('preserves link text and removes strong/emphasis markers', () => {
    const input =
      'Read the **[official docs](https://example.com)** for *more* info.'
    const out = markdownToSearchText(input)
    expect(out).toContain('official docs')
    expect(out).toContain('more')
    expect(out).toContain('info')
    expect(out).not.toContain('**')
    expect(out).not.toContain('*')
    expect(out).not.toContain('https://example.com')
    expect(out).not.toContain('](')
  })

  it('does not strip citations inside code blocks', () => {
    const input = '```\nconst ref = [1];\nconst x = [a];\n```'
    const out = markdownToSearchText(input)
    expect(out).toContain('[1]')
    expect(out).toContain('[a]')
  })

  it('does not strip citations inside inline code', () => {
    const input = 'Use `arr[0]` and `map[key]` to access.'
    const out = markdownToSearchText(input)
    expect(out).toContain('arr[0]')
    expect(out).toContain('map[key]')
  })
})
