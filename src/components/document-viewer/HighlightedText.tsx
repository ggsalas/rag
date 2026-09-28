import { useEffect } from 'react'

interface HighlightedTextProps {
  text: string
  highlight: string | null
  highlightRef: React.RefObject<HTMLElement | null>
  /** Start offset of the chunk's content proper in the document text */
  sourceStart?: number
  /** End offset of the chunk's content proper in the document text */
  sourceEnd?: number
}

export function HighlightedText({
  text,
  highlight,
  highlightRef,
  sourceStart,
  sourceEnd,
}: HighlightedTextProps) {
  useEffect(() => {
    if (highlightRef.current) {
      scrollToCenter(highlightRef.current, 200)
    }
  }, [highlight, highlightRef])

  if (!highlight) {
    return <div className="whitespace-pre-wrap text-foreground">{text}</div>
  }

  // Try using offsets first (primary path for new chunks)
  const match = findHighlightMatch(text, sourceStart, sourceEnd, highlight)

  if (!match) {
    return <div className="whitespace-pre-wrap text-foreground">{text}</div>
  }

  const before = text.slice(0, match.start)
  const highlighted = text.slice(match.start, match.end)
  const after = text.slice(match.end)

  return (
    <div className="whitespace-pre-wrap text-foreground">
      {before}
      <mark
        ref={highlightRef}
        className="bg-foreground/20 text-foreground rounded px-0.5"
      >
        {highlighted}
      </mark>
      {after}
    </div>
  )
}

/**
 * Finds the highlight position using offsets (primary) or text search (fallback).
 *
 * Primary path: if sourceStart/sourceEnd are valid offsets within the document,
 * use them directly. This is exact and fast.
 *
 * Fallback path: for old chunks without offsets, search for the highlight text
 * in the document. Uses exact match first, then whitespace-normalized match.
 */
function findHighlightMatch(
  fullText: string,
  sourceStart: number | undefined,
  sourceEnd: number | undefined,
  highlightText: string,
): { start: number; end: number } | null {
  // Primary path: use offsets if valid
  if (isValidOffsetRange(sourceStart, sourceEnd, fullText.length)) {
    return { start: sourceStart!, end: sourceEnd! }
  }

  // Fallback path: search for the highlight text
  return findChunkInText(fullText, highlightText)
}

/**
 * Validates that offsets form a valid range within the document bounds.
 */
function isValidOffsetRange(
  start: number | undefined,
  end: number | undefined,
  textLength: number,
): boolean {
  return (
    start !== undefined &&
    end !== undefined &&
    start >= 0 &&
    end > start &&
    end <= textLength
  )
}

function scrollToCenter(element: HTMLElement, duration: number) {
  const container = element.closest('.overflow-y-auto') as HTMLElement | null
  if (!container) return

  const containerRect = container.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const target =
    container.scrollTop +
    (elementRect.top - containerRect.top) -
    (containerRect.height - elementRect.height) / 2

  const start = container.scrollTop
  const distance = target - start
  const startTime = performance.now()

  const ease = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)

  const step = (now: number) => {
    const progress = Math.min((now - startTime) / duration, 1)
    container.scrollTop = start + distance * ease(progress)
    if (progress < 1) requestAnimationFrame(step)
  }

  requestAnimationFrame(step)
}

function buildSpacelessMap(text: string): { stripped: string; map: number[] } {
  const map: number[] = []
  let stripped = ''
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i]!)) {
      stripped += text[i]
      map.push(i)
    }
  }
  return { stripped, map }
}

function findChunkInText(
  fullText: string,
  chunkText: string,
): { start: number; end: number } | null {
  const exactIndex = fullText.indexOf(chunkText)
  if (exactIndex !== -1) {
    return { start: exactIndex, end: exactIndex + chunkText.length }
  }

  const { stripped: strippedFull, map: fullMap } = buildSpacelessMap(fullText)
  const { stripped: strippedChunk } = buildSpacelessMap(chunkText)

  let idx = strippedFull.indexOf(strippedChunk)
  if (idx !== -1) {
    const start = fullMap[idx]!
    const endIdx = idx + strippedChunk.length - 1
    const end = endIdx < fullMap.length ? fullMap[endIdx]! + 1 : fullText.length
    return { start, end }
  }

  // If not found, skip overlap zone and try with a shorter core
  const attempts = [150, 100, 60]
  for (const skip of attempts) {
    if (skip >= strippedChunk.length - 20) continue
    const core = strippedChunk.slice(skip)
    if (core.length < 20) continue

    idx = strippedFull.indexOf(core)
    if (idx !== -1) {
      const start = fullMap[Math.max(0, idx - skip)]!
      const endIdx = idx + core.length - 1
      const end =
        endIdx < fullMap.length ? fullMap[endIdx]! + 1 : fullText.length
      return { start, end }
    }
  }

  return null
}
