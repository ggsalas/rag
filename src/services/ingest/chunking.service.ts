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
}

export interface ChunkOptions {
  size?: number
  overlap?: number
}

/**
 * Chunks plain text by paragraphs (no heading awareness).
 * Used for .txt and .docx documents that lack Markdown structure.
 *
 * Oversized-unit policy: paragraphs are atomic. A paragraph that exceeds
 * `size` is emitted as a single oversized chunk rather than being split,
 * so sentences are never cut.
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

  /** Join units into a chunk and push it */
  const flush = () => {
    if (currentUnits.length === 0) return
    const joined = currentUnits.join('\n\n')
    chunks.push({
      text: joined,
      searchText: markdownToSearchText(joined),
      sectionPath: [],
      headingText: '',
      chunkIndex,
    })
    chunkIndex++
  }

  /** Pick trailing units from the previous chunk for overlap (whole units only) */
  const computeOverlap = (prevUnits: string[]): string[] => {
    if (overlap <= 0 || prevUnits.length === 0) return []
    const overlapUnits: string[] = []
    let total = 0
    // Walk backwards to collect whole units that fit within overlap budget
    for (let i = prevUnits.length - 1; i >= 0; i--) {
      const addLen = overlapUnits.length === 0
        ? prevUnits[i]!.length
        : prevUnits[i]!.length + 2 // '\n\n' separator
      if (total + addLen > overlap) break
      overlapUnits.unshift(prevUnits[i]!)
      total += addLen
    }
    return overlapUnits
  }

  for (const paragraph of paragraphs) {
    const sepLen = currentUnits.length > 0 ? 2 : 0 // '\n\n'
    const newLen = currentLen + sepLen + paragraph.length

    if (newLen > size && currentUnits.length > 0) {
      // Flush current chunk, then start a new one with overlap
      const prevUnits = currentUnits
      flush()
      const overlapUnits = computeOverlap(prevUnits)
      currentUnits = [...overlapUnits, paragraph]
      currentLen = currentUnits.join('\n\n').length
    } else {
      currentUnits.push(paragraph)
      currentLen = newLen
    }
  }

  flush()
  return chunks
}

/**
 * Chunks Markdown by heading sections with AST block-level packing.
 *
 * - Tracks heading hierarchy to build sectionPath for each chunk
 * - Packs whole AST block units (paragraphs, lists, tables, code blocks, etc.)
 *   into chunks; never slices serialized Markdown strings
 * - This guarantees Markdown links and other inline syntax are never cut
 * - Oversized-unit policy: a single block that exceeds `size` is emitted as
 *   one oversized chunk rather than being split
 * - Avoids orphan heading-only chunks
 * - Every chunk gets the applicable section context
 * - Sequential chunkIndex is preserved
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

  for (const section of sections) {
    const sectionPath = section.headingStack.map((h) => h.text)
    const headingText =
      section.headingStack.length > 0
        ? section.headingStack[section.headingStack.length - 1]!.text
        : ''

    if (section.blocks.length === 0) continue

    // Serialize each block individually to get atomic Markdown units
    const serializedUnits = section.blocks.map((block) => serializeBlocks([block]))

    // Pack whole block units into chunks up to `size`
    let currentUnits: string[] = []
    let currentLen = 0

    /** Join units into a chunk and push it */
    const flush = () => {
      if (currentUnits.length === 0) return
      const joined = currentUnits.join('\n\n')
      chunks.push({
        text: joined,
        searchText: markdownToSearchText(joined),
        sectionPath,
        headingText,
        chunkIndex,
      })
      chunkIndex++
    }

    /** Pick trailing units from the previous chunk for overlap (whole units only) */
    const computeOverlap = (prevUnits: string[]): string[] => {
      if (overlap <= 0 || prevUnits.length === 0) return []
      const overlapUnits: string[] = []
      let total = 0
      for (let i = prevUnits.length - 1; i >= 0; i--) {
        const addLen = overlapUnits.length === 0
          ? prevUnits[i]!.length
          : prevUnits[i]!.length + 2 // '\n\n' separator
        if (total + addLen > overlap) break
        overlapUnits.unshift(prevUnits[i]!)
        total += addLen
      }
      return overlapUnits
    }

    for (const unit of serializedUnits) {
      if (!unit) continue

      const sepLen = currentUnits.length > 0 ? 2 : 0 // '\n\n'
      const newLen = currentLen + sepLen + unit.length

      if (newLen > size && currentUnits.length > 0) {
        // Flush current chunk, then start a new one with overlap
        const prevUnits = currentUnits
        flush()
        const overlapUnits = computeOverlap(prevUnits)
        currentUnits = [...overlapUnits, unit]
        currentLen = currentUnits.join('\n\n').length
      } else {
        currentUnits.push(unit)
        currentLen = newLen
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


