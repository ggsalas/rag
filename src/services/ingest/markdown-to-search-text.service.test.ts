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
})
