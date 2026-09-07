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
 */
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
        searchText: markdownToSearchText(currentChunk.trim()),
        sectionPath: [],
        headingText: '',
        chunkIndex,
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
      const chunkText = currentChunk.slice(0, breakPoint).trim()
      chunks.push({
        text: chunkText,
        searchText: markdownToSearchText(chunkText),
        sectionPath: [],
        headingText: '',
        chunkIndex,
      })
      chunkIndex++

      const remaining = currentChunk.slice(breakPoint - overlap).trim()
      currentChunk = remaining
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      searchText: markdownToSearchText(currentChunk.trim()),
      sectionPath: [],
      headingText: '',
      chunkIndex,
    })
  }

  return chunks
}

/**
 * Chunks Markdown by heading sections with paragraph-aware splitting.
 *
 * - Tracks heading hierarchy to build sectionPath for each chunk
 * - Chunks by complete paragraphs within a section when possible
 * - Splits oversized paragraphs at sentence/word boundaries
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

    // Serialize section content blocks to Markdown
    const sectionMarkdown = serializeBlocks(section.blocks)

    if (!sectionMarkdown.trim()) continue

    if (sectionMarkdown.length <= size) {
      // Section fits in one chunk
      const chunkText = sectionMarkdown.trim()
      chunks.push({
        text: chunkText,
        searchText: markdownToSearchText(chunkText),
        sectionPath,
        headingText,
        chunkIndex,
      })
      chunkIndex++
    } else {
      // Section too long — split by paragraphs within the section
      const subChunks = splitByParagraphs(sectionMarkdown, size, overlap)
      for (const sub of subChunks) {
        chunks.push({
          text: sub,
          searchText: markdownToSearchText(sub),
          sectionPath,
          headingText,
          chunkIndex,
        })
        chunkIndex++
      }
    }
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
 * Splits Markdown text by paragraphs, respecting size limits.
 * Falls back to sentence/word splitting for oversized paragraphs.
 */
function splitByParagraphs(
  text: string,
  size: number,
  overlap: number,
): string[] {
  const chunks: string[] = []
  const paragraphs = text.split(/\n\s*\n/)
  let currentChunk = ''

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (!trimmed) continue

    // If adding this paragraph exceeds size limit, close current chunk
    if (
      currentChunk.length + trimmed.length + 1 > size &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk.trim())

      // Overlap: keep the last `overlap` chars from the previous chunk
      if (overlap > 0 && currentChunk.length > overlap) {
        currentChunk = currentChunk.slice(-overlap) + '\n\n' + trimmed
      } else {
        currentChunk = trimmed
      }
    } else {
      currentChunk = currentChunk ? currentChunk + '\n\n' + trimmed : trimmed
    }

    // If a single paragraph exceeds size, split by sentences
    while (currentChunk.length > size) {
      const breakPoint = findBreakPoint(currentChunk, size)
      chunks.push(currentChunk.slice(0, breakPoint).trim())

      const remaining = currentChunk.slice(breakPoint - overlap).trim()
      currentChunk = remaining
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
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
