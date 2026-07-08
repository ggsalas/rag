import { describe, it, expect } from 'vitest'
import { sanitize } from './sanitize.service'

describe('sanitize', () => {
  it('returns empty string unchanged', () => {
    expect(sanitize('')).toBe('')
  })

  it('preserves clean markdown untouched (aside from whitespace normalization)', () => {
    const input = `## Section

A normal paragraph with **bold** text.

- item one
- item two`
    expect(sanitize(input)).toContain('## Section')
    expect(sanitize(input)).toContain('A normal paragraph with **bold** text.')
    expect(sanitize(input)).toContain('- item one')
  })

  it('strips inline citation markers', () => {
    expect(sanitize('foo [12] bar')).toBe('foo bar')
    expect(sanitize('foo [12][13][14] bar')).toBe('foo bar')
    expect(sanitize('foo[1] bar[2][3] baz')).toBe('foo bar baz')
  })

  it('unwraps markdown links inside paragraph text', () => {
    expect(sanitize('See [the article](https://example.com) for more.')).toBe(
      'See the article for more.',
    )
  })

  it('drops a standalone short link line (treated as nav)', () => {
    expect(sanitize('[label](url "title")')).toBe('')
  })

  it('drops pure-link lines (nav / language lists)', () => {
    const input = `Real paragraph here.

[Afrikaans](https://af.wikipedia.org/wiki/Britney_Spears)
[Deutsch](https://de.wikipedia.org/wiki/Britney_Spears)
[Español](https://es.wikipedia.org/wiki/Britney_Spears)

Another real paragraph.`
    const out = sanitize(input)
    expect(out).toContain('Real paragraph here.')
    expect(out).toContain('Another real paragraph.')
    expect(out).not.toContain('Afrikaans')
    expect(out).not.toContain('Deutsch')
  })

  it('drops empty markdown table rows and separators', () => {
    const input = `|col1|col2|col3|
|---|---|---|
| | | |
|value|other|third|
| | | |`
    const out = sanitize(input)
    expect(out).not.toMatch(/^\s*\|\s*\|\s*\|\s*$/m)
    expect(out).not.toMatch(/^\|---\|/m)
    expect(out).toContain('value')
    expect(out).toContain('other')
  })

  it('strips markdown images (inline and reference)', () => {
    expect(sanitize('before ![alt](img.png) after')).toBe('before after')
    expect(sanitize('before ![][button_0_1.png] after')).toBe('before after')
  })

  it('drops Wikipedia nav labels', () => {
    const input = `Main menu

Navigation

Real content here.

Tools

Actions

More real content.`
    const out = sanitize(input)
    expect(out).not.toContain('Main menu')
    expect(out).not.toContain('Navigation')
    expect(out).not.toContain('Tools')
    expect(out).not.toContain('Actions')
    expect(out).toContain('Real content here.')
    expect(out).toContain('More real content.')
  })

  it('unwraps a paragraph wrapped in a single link (Wikipedia MD pattern)', () => {
    const input =
      '[Britney Jean Spears (born December 2, 1981) is an American singer.](//en.wikipedia.org/wiki/Foo!A1)'
    const out = sanitize(input)
    expect(out).toBe(
      'Britney Jean Spears (born December 2, 1981) is an American singer.',
    )
  })

  it('handles the Britney.md worst-case block', () => {
    const input = `# Sheet1

|[FALSE](Sheet1!bodyContent)| | |
|---|---|---|
|Main menu Main menu![][button_0_0.png]|![][button_0_1.png]| |
|Navigation| | |
| | | |
|[Main page](/wiki/Main_Page!A1)| | |
|[Contents](/wiki/Wikipedia:Contents!A1)| | |
|[Current events](/wiki/Portal:Current_events!A1)| | |
| | | |
|[Britney Jean Spears (born December 2, 1981) is an American singer. Referred to as the "Princess of Pop", she is widely regarded as one of the most influential entertainers of the 21st century.](//en.wikipedia.org/wiki/Foo!A1)| | |`
    const out = sanitize(input)
    // Nav must be gone
    expect(out).not.toContain('Main menu')
    expect(out).not.toContain('Main page')
    expect(out).not.toContain('button_0_0.png')
    // Real content preserved and unwrapped
    expect(out).toContain('Britney Jean Spears (born December 2, 1981)')
    expect(out).toContain('Princess of Pop')
    expect(out).not.toContain('en.wikipedia.org')
    expect(out).not.toContain('!A1')
  })

  it('collapses excessive blank lines', () => {
    const input = 'a\n\n\n\n\nb'
    expect(sanitize(input)).toBe('a\n\nb')
  })

  it('is idempotent', () => {
    const input = `[foo](url) and [12] and ![img](x.png)

|a|b|
| | |`
    const once = sanitize(input)
    const twice = sanitize(once)
    expect(twice).toBe(once)
  })
})
