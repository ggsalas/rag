import { CHUNK_SIZE, CHUNK_OVERLAP } from '@/lib/constants'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import type { Root, Heading, BlockContent, PhrasingContent } from 'mdast'
import { markdownToSearchText } from './markdown-to-search-text.service'

export interface ChunkData {
  /** Sanitized Markdown text for display and highlighting */
  text: string
  /** Plain text for retrieval (no Markdown syntax) */
  searchText: string
  /** Heading hierarchy path (e.g. ["Introduction", "Methods"]) */
  sectionPath: string[]
  /** Immediate parent heading text */
  headingText: string
  chunkIndex: number
  /**
   * Start offset of chunk's content proper in the original document text.
   * Excludes the overlap prefix (overlap is shared with previous chunk).
   * For multi-block chunks, this is the start of the first content block.
   * Undefined for plain-text chunking (chunkText) which has no AST positions.
   */
  sourceStart?: number
  /**
   * End offset of chunk's content proper in the original document text.
   * Excludes the overlap prefix. For multi-block chunks, this is the end of
   * the last content block. The range [sourceStart, sourceEnd] may include
   * inter-block whitespace that differs from the chunk's text.
   * Undefined for plain-text chunking (chunkText).
   */
  sourceEnd?: number
}

/** Internal: a text unit with offset tracking */
interface TextUnit {
  text: string
  /** Start offset in original document (-1 for overlap units) */
  start: number
  /** End offset in original document (-1 for overlap units) */
  end: number
}

export interface ChunkOptions {
  size?: number
  overlap?: number
}

/**
 * Returns true if searchText is too trivial to index (empty, whitespace-only,
 * or contains no alphanumeric character).
 *
 * This catches thematicBreak artifacts (`***`, `---`, `·`) that serialize to
 * Markdown but yield empty or non-alphanumeric searchText after stripping.
 * It does NOT discard short but meaningful text (a sentence, a code snippet,
 * a list item).
 */
function isTrivialSearchText(searchText: string): boolean {
  const trimmed = searchText.trim()
  if (trimmed.length === 0) return true
  // Must contain at least one letter or digit to be meaningful
  return !/[a-zA-Z0-9]/.test(trimmed)
}

/**
 * Regex matching a well-formed Markdown link `[text](url)`.
 *
 * Handles escaped brackets inside the text part (e.g. `[\[234\] text](url)`).
 * The text part matches `(?:[^\]\\]|\\.)*` — any char except `]` or `\`,
 * OR a backslash followed by any char (escape sequence).
 */
const MARKDOWN_LINK_REGEX = /\[(?:[^\]\\]|\\.)*\]\([^)]*\)/g

/**
 * Finds all Markdown link spans in the text.
 * Returns an array of `[startIndex, endIndex]` pairs (end is exclusive).
 */
function findLinkSpans(text: string): [number, number][] {
  const spans: [number, number][] = []
  const regex = new RegExp(MARKDOWN_LINK_REGEX.source, 'g')
  let match
  while ((match = regex.exec(text)) !== null) {
    spans.push([match.index, match.index + match[0].length])
  }
  return spans
}

/**
 * Returns true if position `pos` falls inside a Markdown link span.
 */
function isInsideLink(pos: number, linkSpans: [number, number][]): boolean {
  return linkSpans.some(([start, end]) => pos > start && pos < end)
}

/**
 * Tokenizes text by whitespace, but keeps Markdown links `[text](url)` as
 * single tokens even if they contain spaces.
 *
 * This prevents the chunker from breaking link syntax when splitting long
 * sentences or paragraphs. A link like `[very important link](https://...)`
 * contains spaces in the text part, which would normally cause it to be split
 * across chunks, breaking the `[text](url)` syntax.
 *
 * Handles escaped brackets inside link text (e.g. `[\[234\] text](url)`).
 */
function tokenizeRespectingLinks(text: string): string[] {
  const tokens: string[] = []
  const regex = new RegExp(MARKDOWN_LINK_REGEX.source, 'g')
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    // Add any text before this link, split by whitespace
    const before = text.slice(lastIndex, match.index)
    if (before.trim()) {
      tokens.push(...before.split(/\s+/).filter(Boolean))
    }
    // Add the link as a single token
    tokens.push(match[0])
    lastIndex = match.index + match[0].length
  }

  // Add any remaining text after the last link
  const after = text.slice(lastIndex)
  if (after.trim()) {
    tokens.push(...after.split(/\s+/).filter(Boolean))
  }

  return tokens
}

/**
 * Splits text into sentence-sized pieces.
 *
 * Sentence boundaries are detected at `.`, `!`, or `?` followed by whitespace
 * or end-of-string. Each piece is trimmed.
 *
 * Markdown links `[text](url)` are kept intact: sentence boundaries inside
 * links (e.g. `Chart. The` within `[...Chart. The...](url)`) do NOT produce
 * splits. This prevents breaking link syntax.
 *
 * If no sentence boundary is found (e.g. a single long URL or code block),
 * falls back to splitting at the nearest whitespace to avoid exceeding the
 * budget with a single unbreakable unit.
 */
export function splitIntoSentences(text: string): string[] {
  // Find all link spans so we can avoid splitting inside them
  const linkSpans = findLinkSpans(text)

  // Find all candidate split positions: after `.`, `!`, or `?` followed by whitespace
  const splitRegex = /(?<=[.!?])\s+/g
  const splitPositions: number[] = []
  let match
  while ((match = splitRegex.exec(text)) !== null) {
    // match.index is the start of the whitespace; the split goes AFTER the punctuation
    // i.e., at match.index (everything before goes to current sentence, whitespace + rest to next)
    const splitPos = match.index
    // Only split if this position is NOT inside a link
    if (!isInsideLink(splitPos, linkSpans)) {
      splitPositions.push(splitPos)
    }
  }

  // Build sentences from split positions
  if (splitPositions.length === 0) {
    // No sentence boundary found — fall back to whitespace splitting
    if (text.length > 0) {
      const words = tokenizeRespectingLinks(text)
      if (words.length <= 1) return [text]
      // Group words into ~100-char chunks
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

  // Split at the identified positions
  const sentences: string[] = []
  let lastSplit = 0
  for (const pos of splitPositions) {
    const sentence = text.slice(lastSplit, pos).trim()
    if (sentence) sentences.push(sentence)
    // Skip whitespace after the split position
    let nextStart = pos
    while (nextStart < text.length && /\s/.test(text[nextStart]!)) {
      nextStart++
    }
    lastSplit = nextStart
  }
  // Add the remaining text
  const last = text.slice(lastSplit).trim()
  if (last) sentences.push(last)

  return sentences
}

/**
 * Splits a text unit that exceeds the budget into sentence-sized sub-units.
 *
 * Each sub-unit is at most `maxLen` characters. Sub-units are split at sentence
 * boundaries so words and sentences are never cut mid-token.
 *
 * If a single sentence still exceeds `maxLen` (e.g. a long sentence with many
 * citation markers), it is further split at whitespace boundaries.
 */
export function splitOversizedUnit(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]

  const sentences = splitIntoSentences(text)
  const pieces: string[] = []
  let current = ''

  for (const sentence of sentences) {
    // If this single sentence exceeds maxLen, split it at whitespace
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
      if (current.length + sepLen + sentence.length > maxLen && current.length > 0) {
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
 * Splits text at whitespace boundaries so each piece is at most `maxLen` chars.
 *
 * Used as a fallback when a single sentence (no internal sentence boundaries)
 * exceeds the budget — e.g. a long sentence with many citation markers.
 * Never cuts mid-word. Markdown links `[text](url)` are kept as atomic tokens
 * to prevent breaking link syntax, even if a link exceeds `maxLen` (in which
 * case the link is placed in its own chunk — breaking syntax is worse than
 * exceeding the budget).
 */
function splitAtWhitespace(text: string, maxLen: number): string[] {
  // Tokenize respecting Markdown links to avoid breaking [text](url) syntax
  const words = tokenizeRespectingLinks(text)
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
 * Splits text at whitespace boundaries, tracking each piece's position.
 * Returns {text, start, end} where start/end are offsets in the original text.
 *
 * Unlike splitAtWhitespace, this preserves positions by tracking where each word
 * appears in the original text, rather than reconstructing pieces by joining.
 */
function splitAtWhitespaceWithPositions(
  text: string,
  maxLen: number,
): { text: string; start: number; end: number }[] {
  const words = tokenizeRespectingLinks(text)
  const result: { text: string; start: number; end: number }[] = []
  let current = ''
  let currentStart = -1
  let currentEnd = -1
  let searchFrom = 0

  for (const word of words) {
    // Find this word in the original text
    const wordIdx = text.indexOf(word, searchFrom)
    if (wordIdx === -1) {
      // Word not found (shouldn't happen, but handle gracefully)
      continue
    }
    const wordEnd = wordIdx + word.length

    const sepLen = current.length > 0 ? 1 : 0
    if (current.length + sepLen + word.length > maxLen && current.length > 0) {
      // Flush current piece
      result.push({ text: current, start: currentStart, end: currentEnd })
      // Start new piece with this word
      current = word
      currentStart = wordIdx
      currentEnd = wordEnd
    } else {
      if (current.length === 0) {
        currentStart = wordIdx
      }
      current = current.length > 0 ? current + ' ' + word : word
      currentEnd = wordEnd
    }
    searchFrom = wordEnd
  }

  // Flush remaining
  if (current.length > 0) {
    result.push({ text: current, start: currentStart, end: currentEnd })
  }

  return result.length > 0 ? result : [{ text, start: 0, end: text.length }]
}

/**
 * Extracts trailing text from the previous chunk for overlap.
 *
 * Takes up to `overlapChars` characters from the end of `prevText`, then trims
 * backward to the nearest sentence boundary (`.`, `!`, `?` followed by
 * whitespace) so the overlap starts at a clean sentence. If no sentence
 * boundary is found within the overlap window, the raw trailing text is used.
 *
 * Markdown links `[text](url)` are kept intact: if the cut position falls
 * inside a link, it moves backward to before the link's opening `[`. This
 * prevents broken link syntax in the overlap prefix.
 */
export function extractOverlapText(
  prevText: string,
  overlapChars: number,
): string {
  if (overlapChars <= 0 || prevText.length === 0) return ''

  // Find all link spans in the full text
  const linkSpans = findLinkSpans(prevText)

  // Initial cut position
  let cutPos = Math.max(0, prevText.length - overlapChars)

  // If the cut falls inside a link, move it before the link start
  // to avoid breaking the link syntax
  for (const [start, end] of linkSpans) {
    if (cutPos > start && cutPos < end) {
      cutPos = start
      break
    }
  }

  // Extract the window from cutPos to end
  let window = prevText.slice(cutPos)

  // Look for a sentence boundary near the start of the window
  // Match: punctuation + whitespace, then capture the rest
  const boundaryMatch = window.match(/^[^.!?]*[.!?]\s+(.*)$/)
  if (boundaryMatch && boundaryMatch[1]) {
    return boundaryMatch[1].trim()
  }

  // No sentence boundary found — use the raw window
  return window.trim()
}

/**
 * Chunks plain text by paragraphs (no heading awareness).
 * Used for .txt and .docx documents that lack Markdown structure.
 *
 * - Paragraphs that exceed `size` are split by sentences (never mid-word).
 * - Overlap is measured in characters, taken from the trailing sentences of
 *   the previous chunk.
 * - Chunks with empty or trivial searchText are discarded.
 */
export function chunkText(text: string, options?: ChunkOptions): ChunkData[] {
  const size = options?.size ?? CHUNK_SIZE
  const overlap = options?.overlap ?? CHUNK_OVERLAP
  const chunks: ChunkData[] = []

  if (!text.trim()) return chunks

  // Split by blank-line paragraphs — each paragraph is an atomic unit
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)

  let currentUnits: string[] = []
  let currentLen = 0
  let chunkIndex = 0
  let prevChunkText = ''

  /** Join units into a chunk and push it */
  const flush = () => {
    if (currentUnits.length === 0) return
    const joined = currentUnits.join('\n\n')
    const searchText = markdownToSearchText(joined)

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
    const units = paragraph.length > size
      ? splitOversizedUnit(paragraph, Math.max(size - overlap, size / 2))
      : [paragraph]

    for (const unit of units) {
      const sepLen = currentUnits.length > 0 ? 2 : 0 // '\n\n'
      const newLen = currentLen + sepLen + unit.length

      if (newLen > size && currentUnits.length > 0) {
        // Flush current chunk, then start a new one with overlap
        flush()
        const overlapText = extractOverlapText(prevChunkText, overlap)
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
 * Chunks Markdown by heading sections with AST block-level packing.
 *
 * - Tracks heading hierarchy to build sectionPath for each chunk
 * - Slices each block from the original document text using AST position offsets
 *   (no re-serialization — chunk text is literally the original document text)
 * - Packs whole AST block units (paragraphs, lists, tables, code blocks, etc.)
 *   into chunks; never slices serialized Markdown strings
 * - Blocks that exceed `size` are split by sentences (never mid-word)
 * - ThematicBreak nodes (horizontal rules like `***`) are discarded — they
 *   produce empty searchText and contaminate BM25 statistics
 * - Overlap is measured in characters, taken from trailing sentences of the
 *   previous chunk
 * - Chunks with empty or trivial searchText are discarded
 * - Avoids orphan heading-only chunks
 * - Every chunk gets the applicable section context
 * - Sequential chunkIndex is preserved
 * - sourceStart/sourceEnd track the offset range of the chunk's content proper
 *   (excluding overlap prefix) in the original document
 */
export function chunkMarkdown(
  text: string,
  options?: ChunkOptions,
): ChunkData[] {
  const size = options?.size ?? CHUNK_SIZE
  const overlap = options?.overlap ?? CHUNK_OVERLAP

  if (!text.trim()) return []

  const tree = unified().use(remarkParse).use(remarkGfm).parse(text)

  // Build sections: each section has a heading stack and a list of content blocks
  const sections = buildSections(tree)

  // Convert sections to chunks
  const chunks: ChunkData[] = []
  let chunkIndex = 0
  let prevChunkText = ''

  for (const section of sections) {
    const sectionPath = section.headingStack.map((h) => h.text)
    const headingText =
      section.headingStack.length > 0
        ? section.headingStack[section.headingStack.length - 1]!.text
        : ''

    if (section.blocks.length === 0) continue

    // Slice each block from original text using AST position offsets
    const slicedUnits = section.blocks.map((block) => sliceBlock(block, text))

    // Pack whole block units into chunks up to `size`
    let currentUnits: TextUnit[] = []
    let currentLen = 0

    /** Join units into a chunk and push it */
    const flush = () => {
      if (currentUnits.length === 0) return
      
      // Separate overlap (first unit with start=-1) from content proper
      const hasOverlap = currentUnits.length > 0 && currentUnits[0]!.start === -1
      const contentUnits = hasOverlap ? currentUnits.slice(1) : currentUnits
      
      // Build chunk text
      const textParts = currentUnits.map(u => u.text)
      const joined = textParts.join('\n\n')
      const searchText = markdownToSearchText(joined)

      // Skip chunks with empty or trivial searchText (no alphanumeric content)
      if (!isTrivialSearchText(searchText)) {
        // Compute sourceStart/sourceEnd from content proper (excluding overlap)
        const sourceStart = contentUnits.length > 0 ? contentUnits[0]!.start : undefined
        const sourceEnd = contentUnits.length > 0 ? contentUnits[contentUnits.length - 1]!.end : undefined

        chunks.push({
          text: joined,
          searchText,
          sectionPath,
          headingText,
          chunkIndex,
          sourceStart: sourceStart !== undefined && sourceStart >= 0 ? sourceStart : undefined,
          sourceEnd: sourceEnd !== undefined && sourceEnd >= 0 ? sourceEnd : undefined,
        })
        chunkIndex++
        prevChunkText = joined
      }
    }

    for (const rawUnit of slicedUnits) {
      if (!rawUnit.text) continue

      // Split oversized units by sentences.
      // The first unit of a new chunk will have overlap prepended, so it must
      // leave room for the overlap. Use (size - overlap) as the max length for
      // the first piece, and `size` for subsequent pieces.
      let units: TextUnit[]
      if (rawUnit.text.length > size) {
        const firstPieceMax = Math.max(size - overlap, size / 2)
        const pieces = splitOversizedUnitWithOffsets(rawUnit, firstPieceMax)
        // Subsequent pieces can use the full size
        units = []
        for (let i = 0; i < pieces.length; i++) {
          if (i === 0) {
            units.push(pieces[i]!)
          } else if (pieces[i]!.text.length > size) {
            units.push(...splitOversizedUnitWithOffsets(pieces[i]!, size))
          } else {
            units.push(pieces[i]!)
          }
        }
      } else {
        units = [rawUnit]
      }

      for (const unit of units) {
        const sepLen = currentUnits.length > 0 ? 2 : 0 // '\n\n'
        const newLen = currentLen + sepLen + unit.text.length

        if (newLen > size && currentUnits.length > 0) {
          // Flush current chunk, then start a new one with overlap
          flush()
          const overlapText = extractOverlapText(prevChunkText, overlap)
          if (overlapText) {
            // Mark overlap unit with start=-1 to distinguish from content
            currentUnits = [{ text: overlapText, start: -1, end: -1 }, unit]
            currentLen = overlapText.length + 2 + unit.text.length
          } else {
            currentUnits = [unit]
            currentLen = unit.text.length
          }
        } else {
          currentUnits.push(unit)
          currentLen = newLen
        }
      }
    }

    flush()
  }

  return chunks
}

/** Represents a heading in the hierarchy */
interface HeadingInfo {
  level: number
  text: string
}

/** Represents a section with its heading context and content blocks */
interface Section {
  headingStack: HeadingInfo[]
  blocks: BlockContent[]
}

/**
 * Walks the AST and groups content blocks into sections based on heading hierarchy.
 * Each section has the heading stack active at that point and its content blocks.
 *
 * ThematicBreak nodes (horizontal rules like `***` or `---`) are skipped — they
 * carry no semantic content and produce empty searchText after Markdown stripping.
 */
function buildSections(tree: Root): Section[] {
  const sections: Section[] = []
  const headingStack: HeadingInfo[] = []
  let currentBlocks: BlockContent[] = []

  // Helper: flush current blocks into a section
  const flushBlocks = () => {
    if (currentBlocks.length > 0) {
      sections.push({
        headingStack: [...headingStack],
        blocks: [...currentBlocks],
      })
      currentBlocks = []
    }
  }

  for (const node of tree.children) {
    if (node.type === 'heading') {
      // Flush any content before this heading
      flushBlocks()

      const heading = node as Heading
      const headingText = extractHeadingText(heading)
      const level = heading.depth

      // Pop headings from stack that are at same or deeper level
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1]!.level >= level
      ) {
        headingStack.pop()
      }

      // Push this heading onto the stack
      headingStack.push({ level, text: headingText })
    } else if (node.type === 'thematicBreak') {
      // Skip horizontal rules — they carry no semantic content and produce
      // empty searchText (e.g. `***` → markdownToSearchText → `''`).
      // Keeping them would create junk chunks that contaminate BM25 stats.
      continue
    } else {
      // Non-heading block — add to current section
      currentBlocks.push(node as BlockContent)
    }
  }

  // Flush remaining blocks
  flushBlocks()

  return sections
}

/**
 * Extracts plain text from a heading node.
 */
function extractHeadingText(heading: Heading): string {
  const parts: string[] = []

  const extractText = (node: PhrasingContent | Heading): void => {
    if (node.type === 'text' && 'value' in node) {
      parts.push((node as any).value)
    } else if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        extractText(child as PhrasingContent)
      }
    }
  }

  extractText(heading)
  return parts.join(' ')
}

/**
 * Serializes AST blocks back to Markdown text.
 * Used as fallback when position offsets are unavailable.
 */
function serializeBlocks(blocks: BlockContent[]): string {
  // Create a minimal root node with just these blocks
  const root: Root = { type: 'root', children: blocks }

  const result = unified()
    // remarkGfm registers table handlers; without it, GFM table nodes throw
    // "Cannot handle unknown node `table`". Disable column padding / pipe
    // alignment to keep sparse tables compact (same rationale as sanitize.service.ts).
    .use(remarkGfm, { tableCellPadding: false, tablePipeAlign: false })
    .use(remarkStringify, {
      bullet: '-',
      fences: true,
      listItemIndent: 'one',
      emphasis: '_',
      strong: '*',
    })
    .stringify(root)

  return result.trim()
}

/**
 * Slices a block from the original document text using AST position offsets.
 * Returns a TextUnit with the original text and its offset range.
 * Falls back to serialization if position is unavailable (should not happen with remark-parse).
 */
function sliceBlock(block: BlockContent, originalText: string): TextUnit {
  const start = block.position?.start?.offset
  const end = block.position?.end?.offset
  
  if (start != null && end != null) {
    return {
      text: originalText.slice(start, end),
      start,
      end,
    }
  }
  
  // Fallback: serialize (should not happen with remark-parse, but handle gracefully)
  console.warn('[chunking] Block missing position offsets, falling back to serialization')
  return {
    text: serializeBlocks([block]),
    start: -1,
    end: -1,
  }
}

/**
 * Splits text into sentences, tracking each sentence's position in the original.
 * Returns {text, start, end} where start/end are offsets of the trimmed content
 * within the original text.
 *
 * Mirrors splitIntoSentences logic but preserves positions so callers can
 * reassemble pieces without losing offset information.
 */
function splitIntoSentencesWithPositions(
  text: string,
): { text: string; start: number; end: number }[] {
  const linkSpans = findLinkSpans(text)

  // Find split positions (after punctuation + whitespace)
  const splitRegex = /(?<=[.!?])\s+/g
  const splitPositions: number[] = []
  let match
  while ((match = splitRegex.exec(text)) !== null) {
    const splitPos = match.index
    if (!isInsideLink(splitPos, linkSpans)) {
      splitPositions.push(splitPos)
    }
  }

  if (splitPositions.length === 0) {
    // Fallback: whitespace-based splitting (same as splitIntoSentences)
    if (text.length > 0) {
      const words = tokenizeRespectingLinks(text)
      if (words.length <= 1) {
        const trimmed = text.trim()
        const start = text.indexOf(trimmed)
        return [{ text: trimmed, start, end: start + trimmed.length }]
      }
      // Group words into ~100-char chunks, tracking positions
      const result: { text: string; start: number; end: number }[] = []
      let current = ''
      let currentStart = -1
      let searchFrom = 0
      for (const word of words) {
        const wordIdx = text.indexOf(word, searchFrom)
        if (current.length > 0 && current.length + 1 + word.length > 100) {
          const trimmed = current.trim()
          const trimStart = current.indexOf(trimmed)
          result.push({
            text: trimmed,
            start: currentStart + trimStart,
            end: currentStart + trimStart + trimmed.length,
          })
          current = word
          currentStart = wordIdx
        } else {
          if (current.length === 0) currentStart = wordIdx
          current = current.length > 0 ? current + ' ' + word : word
        }
        searchFrom = wordIdx + word.length
      }
      if (current.length > 0) {
        const trimmed = current.trim()
        const trimStart = current.indexOf(trimmed)
        result.push({
          text: trimmed,
          start: currentStart + trimStart,
          end: currentStart + trimStart + trimmed.length,
        })
      }
      return result
    }
    return []
  }

  // Split at identified positions, tracking where each trimmed sentence lives
  const result: { text: string; start: number; end: number }[] = []
  let lastSplit = 0
  for (const pos of splitPositions) {
    const raw = text.slice(lastSplit, pos)
    const trimmed = raw.trim()
    if (trimmed.length > 0) {
      const trimStart = raw.indexOf(trimmed)
      result.push({
        text: trimmed,
        start: lastSplit + trimStart,
        end: lastSplit + trimStart + trimmed.length,
      })
    }
    // Skip whitespace after split
    let nextStart = pos
    while (nextStart < text.length && /\s/.test(text[nextStart]!)) {
      nextStart++
    }
    lastSplit = nextStart
  }
  // Remaining text
  const lastRaw = text.slice(lastSplit)
  const lastTrimmed = lastRaw.trim()
  if (lastTrimmed.length > 0) {
    const trimStart = lastRaw.indexOf(lastTrimmed)
    result.push({
      text: lastTrimmed,
      start: lastSplit + trimStart,
      end: lastSplit + trimStart + lastTrimmed.length,
    })
  }
  return result
}

/**
 * Splits an oversized TextUnit into smaller pieces, tracking offsets.
 * Each returned piece has its offset range computed from the original unit.
 *
 * Uses position-tracked sentence splitting instead of indexOf-based search,
 * which is robust against trimming and whitespace normalization.
 */
function splitOversizedUnitWithOffsets(unit: TextUnit, maxLen: number): TextUnit[] {
  if (unit.text.length <= maxLen) return [unit]

  const sentences = splitIntoSentencesWithPositions(unit.text)
  if (sentences.length === 0) return [unit]

  const result: TextUnit[] = []
  let current = ''
  let currentStart = -1
  let currentEnd = -1

  for (const sentence of sentences) {
    // If a single sentence exceeds maxLen, split it at whitespace
    if (sentence.text.length > maxLen) {
      // Flush current accumulator first
      if (current.length > 0) {
        result.push({
          text: current,
          start: unit.start + currentStart,
          end: unit.start + currentEnd,
        })
        current = ''
        currentStart = -1
        currentEnd = -1
      }
      // Split the long sentence at whitespace boundaries, tracking positions
      const subPieces = splitAtWhitespaceWithPositions(sentence.text, maxLen)
      // Convert positions to absolute offsets
      for (const subPiece of subPieces) {
        result.push({
          text: subPiece.text,
          start: unit.start + sentence.start + subPiece.start,
          end: unit.start + sentence.start + subPiece.end,
        })
      }
    } else {
      const sepLen = current.length > 0 ? 2 : 0 // '\n\n'
      if (current.length + sepLen + sentence.text.length > maxLen && current.length > 0) {
        // Flush current piece
        result.push({
          text: current,
          start: unit.start + currentStart,
          end: unit.start + currentEnd,
        })
        // Start new piece
        current = sentence.text
        currentStart = sentence.start
        currentEnd = sentence.end
      } else {
        if (current.length === 0) {
          currentStart = sentence.start
        }
        current = current.length > 0 ? current + '\n\n' + sentence.text : sentence.text
        currentEnd = sentence.end
      }
    }
  }

  // Flush remaining
  if (current.length > 0) {
    result.push({
      text: current,
      start: unit.start + currentStart,
      end: unit.start + currentEnd,
    })
  }

  return result.length > 0 ? result : [unit]
}
