import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import { HighlightedText } from './HighlightedText'

describe('HighlightedText', () => {
  const documentText =
    'First paragraph with some text.\n\nSecond paragraph with the target content.\n\nThird paragraph with more text.'
  const highlightRef = createRef<HTMLElement>()

  it('uses offsets when valid (primary path)', () => {
    // "target content" starts at index 59 in documentText
    const sourceStart = 59
    const sourceEnd = 73

    const { container } = render(
      <HighlightedText
        text={documentText}
        highlight="target content"
        highlightRef={highlightRef}
        sourceStart={sourceStart}
        sourceEnd={sourceEnd}
      />,
    )

    const mark = container.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark?.textContent).toBe('target content')
  })

  it('falls back to text search when offsets are undefined', () => {
    // No offsets provided — should search for the text
    const { container } = render(
      <HighlightedText
        text={documentText}
        highlight="target content"
        highlightRef={highlightRef}
      />,
    )

    const mark = container.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark?.textContent).toBe('target content')
  })

  it('falls back gracefully when offsets are out of range', () => {
    // Offsets beyond document length — should fall back to text search
    const { container } = render(
      <HighlightedText
        text={documentText}
        highlight="target content"
        highlightRef={highlightRef}
        sourceStart={9999}
        sourceEnd={10000}
      />,
    )

    const mark = container.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark?.textContent).toBe('target content')
  })

  it('falls back gracefully when offsets are inverted', () => {
    // End before start — should fall back to text search
    const { container } = render(
      <HighlightedText
        text={documentText}
        highlight="target content"
        highlightRef={highlightRef}
        sourceStart={66}
        sourceEnd={50}
      />,
    )

    const mark = container.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark?.textContent).toBe('target content')
  })

  it('falls back gracefully when offsets are negative', () => {
    // Negative offsets — should fall back to text search
    const { container } = render(
      <HighlightedText
        text={documentText}
        highlight="target content"
        highlightRef={highlightRef}
        sourceStart={-10}
        sourceEnd={-5}
      />,
    )

    const mark = container.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark?.textContent).toBe('target content')
  })

  it('renders without highlight when highlight is null', () => {
    const { container } = render(
      <HighlightedText
        text={documentText}
        highlight={null}
        highlightRef={highlightRef}
        sourceStart={59}
        sourceEnd={73}
      />,
    )

    const mark = container.querySelector('mark')
    expect(mark).toBeNull()
    expect(container.textContent).toContain(documentText)
  })

  it('renders without highlight when text is not found', () => {
    const { container } = render(
      <HighlightedText
        text={documentText}
        highlight="nonexistent text"
        highlightRef={highlightRef}
      />,
    )

    const mark = container.querySelector('mark')
    expect(mark).toBeNull()
    expect(container.textContent).toContain(documentText)
  })
})
