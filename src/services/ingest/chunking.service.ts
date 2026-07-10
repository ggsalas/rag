import { CHUNK_SIZE, CHUNK_OVERLAP } from '@/lib/constants'

export interface ChunkData {
  text: string
  chunkIndex: number
  /** Immediate heading of the section this chunk belongs to, or '' for pre-heading preamble */
  headingText: string
  /** Root → leaf breadcrumb of ancestor headings */
  sectionPath: string[]
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
      chunks.push({
        text: currentChunk.trim(),
        chunkIndex,
        headingText: '',
        sectionPath: [],
      })
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
        headingText: '',
        sectionPath: [],
      })
      chunkIndex++

      const remaining = currentChunk.slice(breakPoint - overlap).trim()
      currentChunk = remaining
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      chunkIndex,
      headingText: '',
      sectionPath: [],
    })
  }

  return chunks
}

interface Section {
  path: string[]
  headingText: string
  level: number // 1..6, or 0 for pre-heading preamble
  body: string
}

/**
 * Walks the markdown line by line, maintaining a heading stack. Emits one
 * `Section` per contiguous body between headings, carrying the full breadcrumb.
 *
 * Stack semantics: when a level-N heading appears, all active headings at
 * level >= N are dropped and the new heading is pushed at level N. This
 * guarantees a chunk under `## Artistry > ### Influences` doesn't inherit
 * a stale H3 from a previous parent section.
 */
function parseSections(text: string): Section[] {
  const sections: Section[] = []
  const stack: string[] = [] // stack[i] = heading title at level i+1
  let bodyLines: string[] = []
  let currentHeading = ''
  let currentLevel = 0

  const flush = () => {
    const body = bodyLines.join('\n').trim()
    if (!body && !currentHeading) return
    sections.push({
      path: stack.filter(Boolean),
      headingText: currentHeading,
      level: currentLevel,
      body,
    })
  }

  for (const line of text.split('\n')) {
    const m = line.match(/^(#{1,6}) (.+)$/)
    if (m) {
      // Emit the section that just ended (if any).
      flush()
      const level = m[1]!.length
      const title = m[2]!.trim()
      // Pop all headings at level >= this one, then set this level.
      stack.length = level - 1
      stack.push(title)
      currentHeading = title
      currentLevel = level
      bodyLines = []
    } else {
      bodyLines.push(line)
    }
  }
  flush()

  return sections
}

/**
 * Formats the immediate heading as a markdown prefix that gets prepended
 * to each chunk's text. This ensures both the vector embedding and the BM25
 * text-field pick up the section's heading term, so a chunk under
 * `## Discography` still surfaces for the query "Discography" even when its
 * body doesn't repeat the word.
 */
function headingPrefix(section: Section): string {
  if (!section.headingText || section.level === 0) return ''
  return '#'.repeat(section.level) + ' ' + section.headingText
}

/**
 * Chunks markdown by heading sections. Each chunk carries the immediate
 * heading (prepended to `text`) plus full-breadcrumb metadata for retrieval.
 * Sections that exceed `size` are split via paragraph chunking; every sub-chunk
 * inherits the same heading and sectionPath.
 */
export function chunkMarkdown(
  text: string,
  options?: ChunkOptions,
): ChunkData[] {
  const size = options?.size ?? CHUNK_SIZE
  const overlap = options?.overlap ?? CHUNK_OVERLAP
  const chunks: ChunkData[] = []
  let chunkIndex = 0

  for (const section of parseSections(text)) {
    if (!section.body.trim() && !section.headingText) continue

    const prefix = headingPrefix(section)
    const body = section.body.trim()

    // Section without body content (just a heading with nothing underneath):
    // skip — it's boilerplate that would embed poorly. Its heading is still
    // carried into child-section chunks via sectionPath.
    if (prefix && !body) continue

    // Combined form used when the whole section fits under `size`.
    const combined = prefix
      ? body
        ? `${prefix}\n\n${body}`
        : prefix
      : body

    if (combined.length <= size) {
      chunks.push({
        text: combined,
        chunkIndex,
        headingText: section.headingText,
        sectionPath: [...section.path],
      })
      chunkIndex++
      continue
    }

    // Section too long — chunk the body and prepend the heading to each piece.
    // Reserve room in `size` for the heading so the final chunk stays under budget.
    const budget = prefix ? Math.max(200, size - prefix.length - 2) : size
    const subChunks = chunkText(body, { size: budget, overlap })

    for (const sub of subChunks) {
      const chunkText = prefix ? `${prefix}\n\n${sub.text}` : sub.text
      chunks.push({
        text: chunkText,
        chunkIndex,
        headingText: section.headingText,
        sectionPath: [...section.path],
      })
      chunkIndex++
    }
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
