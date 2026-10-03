/**
 * Plain-text chunker for the text route.
 *
 * Packs whole paragraphs into chunks. Oversized paragraphs are split at
 * sentence / whitespace boundaries (never mid-word). Overlap is anchored to
 * paragraph/sentence boundaries.
 *
 * No Markdown parsing, no heading inference. sectionPath and headingText
 * are always empty. searchText equals chunk text (already plain).
 */

import { CHUNK_SIZE, CHUNK_OVERLAP } from '@/lib/constants'
import type { ChunkData } from '../ingestion.types'

export interface TextChunkOptions {
  size?: number
  overlap?: number
}

/**
 * Chunks plain text by paragraphs.
 *
 * - Paragraphs that exceed `size` are split by sentences (never mid-word).
 * - Overlap is measured in characters, taken from the trailing sentences of
 *   the previous chunk.
 * - searchText equals chunk text (already plain, no Markdown stripping needed).
 */
export function chunkPlainText(
  text: string,
  options?: TextChunkOptions,
): ChunkData[] {
  const size = options?.size ?? CHUNK_SIZE
  const overlap = options?.overlap ?? CHUNK_OVERLAP
  const chunks: ChunkData[] = []

  if (!text.trim()) return chunks

  // Split by blank-line paragraphs — each paragraph is an atomic unit
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

  let currentUnits: string[] = []
  let currentLen = 0
  let chunkIndex = 0
  let prevChunkText = ''

  /** Join units into a chunk and push it */
  const flush = () => {
    if (currentUnits.length === 0) return
    const joined = currentUnits.join('\n\n')

    // searchText equals chunk text (already plain)
    const searchText = joined

    // Skip chunks with empty or trivial searchText (no alphanumeric content)
    if (!isTrivialSearchText(searchText)) {
      chunks.push({
        text: joined,
        searchText,
        sectionPath: [],
        headingText: '',
        chunkIndex,
      })
      chunkIndex++
      prevChunkText = joined
    }
  }

  for (const paragraph of paragraphs) {
    // Split oversized paragraphs by sentences.
    // The first piece of a new chunk will have overlap prepended, so it must
    // leave room for the overlap.
    const units =
      paragraph.length > size
        ? splitOversizedParagraph(paragraph, Math.max(size - overlap, size / 2))
        : [paragraph]

    for (const unit of units) {
      const sepLen = currentUnits.length > 0 ? 2 : 0 // '\n\n'
      const newLen = currentLen + sepLen + unit.length

      if (newLen > size && currentUnits.length > 0) {
        // Flush current chunk, then start a new one with overlap
        flush()
        const overlapText = extractTextOverlap(prevChunkText, overlap)
        if (overlapText) {
          currentUnits = [overlapText, unit]
          currentLen = overlapText.length + 2 + unit.length
        } else {
          currentUnits = [unit]
          currentLen = unit.length
        }
      } else {
        currentUnits.push(unit)
        currentLen = newLen
      }
    }
  }

  flush()
  return chunks
}

/**
 * Returns true if searchText is too trivial to index (empty, whitespace-only,
 * or contains no alphanumeric character).
 */
function isTrivialSearchText(searchText: string): boolean {
  const trimmed = searchText.trim()
  if (trimmed.length === 0) return true
  return !/[a-zA-Z0-9]/.test(trimmed)
}

/**
 * Splits an oversized paragraph into sentence-sized pieces.
 * Sentence boundaries are detected at `.`, `!`, or `?` followed by whitespace.
 * If no sentence boundary is found, falls back to whitespace splitting.
 * Never splits mid-word.
 */
function splitOversizedParagraph(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]

  const sentences = splitIntoSentences(text)
  const pieces: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (sentence.length > maxLen) {
      // Flush current accumulator first
      if (current.length > 0) {
        pieces.push(current)
        current = ''
      }
      // Split the long sentence at whitespace boundaries
      const subPieces = splitAtWhitespace(sentence, maxLen)
      pieces.push(...subPieces)
    } else {
      const sepLen = current.length > 0 ? 2 : 0
      if (
        current.length + sepLen + sentence.length > maxLen &&
        current.length > 0
      ) {
        pieces.push(current)
        current = sentence
      } else {
        current = current.length > 0 ? current + '\n\n' + sentence : sentence
      }
    }
  }

  if (current.length > 0) {
    pieces.push(current)
  }

  return pieces.length > 0 ? pieces : [text]
}

/**
 * Splits text into sentence-sized pieces.
 * Sentence boundaries are detected at `.`, `!`, or `?` followed by whitespace.
 */
function splitIntoSentences(text: string): string[] {
  const splitRegex = /(?<=[.!?])\s+/g
  const splitPositions: number[] = []
  let match
  while ((match = splitRegex.exec(text)) !== null) {
    splitPositions.push(match.index)
  }

  if (splitPositions.length === 0) {
    // No sentence boundary — fall back to whitespace splitting
    if (text.length > 0) {
      const words = text.split(/\s+/).filter(Boolean)
      if (words.length <= 1) return [text]
      const chunks: string[] = []
      let current = ''
      for (const word of words) {
        if (current.length + word.length + 1 > 100 && current.length > 0) {
          chunks.push(current)
          current = word
        } else {
          current = current ? current + ' ' + word : word
        }
      }
      if (current) chunks.push(current)
      return chunks
    }
    return [text]
  }

  const sentences: string[] = []
  let lastSplit = 0
  for (const pos of splitPositions) {
    const sentence = text.slice(lastSplit, pos).trim()
    if (sentence) sentences.push(sentence)
    let nextStart = pos
    while (nextStart < text.length && /\s/.test(text[nextStart]!)) {
      nextStart++
    }
    lastSplit = nextStart
  }
  const last = text.slice(lastSplit).trim()
  if (last) sentences.push(last)

  return sentences
}

/**
 * Splits text at whitespace boundaries so each piece is at most `maxLen` chars.
 * Never cuts mid-word.
 */
function splitAtWhitespace(text: string, maxLen: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const pieces: string[] = []
  let current = ''

  for (const word of words) {
    const sepLen = current.length > 0 ? 1 : 0
    if (current.length + sepLen + word.length > maxLen && current.length > 0) {
      pieces.push(current)
      current = word
    } else {
      current = current.length > 0 ? current + ' ' + word : word
    }
  }

  if (current.length > 0) {
    pieces.push(current)
  }

  return pieces.length > 0 ? pieces : [text]
}

/**
 * Extracts trailing text from the previous chunk for overlap.
 * Takes up to `overlapChars` characters from the end, then trims backward
 * to the nearest sentence boundary so the overlap starts at a clean sentence.
 */
function extractTextOverlap(prevText: string, overlapChars: number): string {
  if (overlapChars <= 0 || prevText.length === 0) return ''

  let cutPos = Math.max(0, prevText.length - overlapChars)
  let window = prevText.slice(cutPos)

  // Look for a sentence boundary near the start of the window
  const boundaryMatch = window.match(/^[^.!?]*[.!?]\s+(.*)$/)
  if (boundaryMatch && boundaryMatch[1]) {
    return boundaryMatch[1].trim()
  }

  return window.trim()
}
