import { CHUNK_SIZE, CHUNK_OVERLAP } from '@/lib/constants'

export interface ChunkData {
  text: string
  chunkIndex: number
  page?: number
}

export interface ChunkOptions {
  size?: number
  overlap?: number
}

/** Splits text into chunks with configurable size and overlap */
export function chunkText(text: string, options?: ChunkOptions): ChunkData[] {
  const size = options?.size ?? CHUNK_SIZE
  const overlap = options?.overlap ?? CHUNK_OVERLAP
  const chunks: ChunkData[] = []

  if (!text.trim()) return chunks

  // Split by paragraphs first
  const paragraphs = text.split(/\n\s*\n/)
  let currentChunk = ''
  let chunkIndex = 0

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (!trimmed) continue

    // If adding this paragraph exceeds size limit, close current chunk
    if (
      currentChunk.length + trimmed.length + 1 > size &&
      currentChunk.length > 0
    ) {
      chunks.push({ text: currentChunk.trim(), chunkIndex })
      chunkIndex++

      // Overlap: keep the last `overlap` chars from the previous chunk
      if (overlap > 0 && currentChunk.length > overlap) {
        currentChunk = currentChunk.slice(-overlap) + ' ' + trimmed
      } else {
        currentChunk = trimmed
      }
    } else {
      currentChunk = currentChunk ? currentChunk + '\n\n' + trimmed : trimmed
    }

    // If a single paragraph exceeds size, split by sentences
    while (currentChunk.length > size) {
      const breakPoint = findBreakPoint(currentChunk, size)
      chunks.push({
        text: currentChunk.slice(0, breakPoint).trim(),
        chunkIndex,
      })
      chunkIndex++

      const remaining = currentChunk.slice(breakPoint - overlap).trim()
      currentChunk = remaining
    }
  }

  if (currentChunk.trim()) {
    chunks.push({ text: currentChunk.trim(), chunkIndex })
  }

  return chunks
}

/** Chunks text with page information preserved (for PDF documents) */
export function chunkTextWithPages(
  pages: string[],
  options?: ChunkOptions,
): ChunkData[] {
  const size = options?.size ?? CHUNK_SIZE
  const overlap = options?.overlap ?? CHUNK_OVERLAP
  const chunks: ChunkData[] = []
  let chunkIndex = 0
  let currentChunk = ''
  let currentPage = 1

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageText = pages[pageIdx]!.trim()
    if (!pageText) continue

    const sentences = splitSentences(pageText)
    for (const sentence of sentences) {
      if (
        currentChunk.length + sentence.length + 1 > size &&
        currentChunk.length > 0
      ) {
        chunks.push({
          text: currentChunk.trim(),
          chunkIndex,
          page: currentPage,
        })
        chunkIndex++
        if (overlap > 0 && currentChunk.length > overlap) {
          currentChunk = currentChunk.slice(-overlap) + ' ' + sentence
        } else {
          currentChunk = sentence
        }
      } else {
        currentChunk = currentChunk ? currentChunk + ' ' + sentence : sentence
      }
      currentPage = pageIdx + 1
    }
  }

  if (currentChunk.trim()) {
    chunks.push({ text: currentChunk.trim(), chunkIndex, page: currentPage })
  }

  return chunks
}

/** Finds an appropriate break point in text to avoid splitting mid-sentence */
function findBreakPoint(text: string, maxLength: number): number {
  // Look for sentence boundary before the limit
  const sub = text.slice(0, maxLength)
  const lastPeriod = sub.lastIndexOf('. ')
  if (lastPeriod > maxLength * 0.5) return lastPeriod + 2
  const lastSpace = sub.lastIndexOf(' ')
  if (lastSpace > maxLength * 0.3) return lastSpace + 1
  return maxLength
}

/** Splits text into sentences for fine-grained chunking */
function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) || [text]
}
