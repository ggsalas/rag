import { describe, it, expect } from 'vitest'
import { normalizeText } from './normalize-text.service'

describe('normalizeText', () => {
  it('returns empty string unchanged', () => {
    expect(normalizeText('')).toBe('')
  })

  it('collapses multiple spaces to single space', () => {
    expect(normalizeText('foo   bar    baz')).toBe('foo bar baz')
  })

  it('converts tabs to spaces', () => {
    expect(normalizeText('foo\t\tbar')).toBe('foo bar')
  })

  it('normalizes CRLF to LF', () => {
    expect(normalizeText('line1\r\nline2\r\nline3')).toBe('line1\nline2\nline3')
  })

  it('normalizes CR to LF', () => {
    expect(normalizeText('line1\rline2')).toBe('line1\nline2')
  })

  it('collapses 3+ blank lines to 2', () => {
    expect(normalizeText('a\n\n\n\nb')).toBe('a\n\nb')
    expect(normalizeText('a\n\n\n\n\n\nb')).toBe('a\n\nb')
  })

  it('preserves single blank line between paragraphs', () => {
    expect(normalizeText('para1\n\npara2')).toBe('para1\n\npara2')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeText('  hello  ')).toBe('hello')
  })

  it('preserves Markdown-like strings literally (never parses as Markdown)', () => {
    // TXT must never interpret Markdown syntax
    const input =
      '# This is NOT a heading\n\n**This is NOT bold**\n\n[This is NOT a link](url)'
    const out = normalizeText(input)
    expect(out).toContain('# This is NOT a heading')
    expect(out).toContain('**This is NOT bold**')
    expect(out).toContain('[This is NOT a link](url)')
  })

  it('preserves literal asterisks and underscores', () => {
    const input = 'Use * for multiplication and _ for underlines.'
    const out = normalizeText(input)
    expect(out).toContain('*')
    expect(out).toContain('_')
  })

  it('preserves literal hash marks', () => {
    const input = '#tag1 #tag2 #tag3'
    const out = normalizeText(input)
    expect(out).toBe('#tag1 #tag2 #tag3')
  })

  it('removes trailing spaces from lines', () => {
    expect(normalizeText('hello   \nworld')).toBe('hello\nworld')
  })

  it('removes leading spaces from lines', () => {
    expect(normalizeText('   hello\n   world')).toBe('hello\nworld')
  })
})
