/**
 * Filters out boilerplate sections (References, Bibliography, etc.) from Markdown.
 *
 * Configurable list of heading names to remove (English/Spanish at minimum).
 * Conservative: only removes sections matching known boilerplate names.
 * Optional generic heuristic available but disabled by default (unreliable).
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import type { Root, Heading, BlockContent } from 'mdast'

/** Default boilerplate section names to filter (English + Spanish) */
const DEFAULT_BOILERPLATE_SECTIONS = [
  // English
  'references',
  'bibliography',
  'notes',
  'external links',
  'further reading',
  'see also',
  'footnotes',
  'sources',
  'citations',
  // Spanish
  'referencias',
  'bibliografía',
  'notas',
  'enlaces externos',
  'lectura adicional',
  'véase también',
  'ver también',
  'fuentes',
  'citas',
]

export interface SectionFilterOptions {
  /** Additional section names to filter (case-insensitive) */
  additionalSections?: string[]
  /** Override default section list */
  sections?: string[]
  /** Enable generic heuristic (disabled by default - unreliable) */
  enableHeuristic?: boolean
}

/**
 * Removes boilerplate sections from Markdown text.
 * Returns cleaned Markdown with References/Bibliography/etc. sections removed.
 */
export function filterBoilerplateSections(
  markdown: string,
  options?: SectionFilterOptions,
): string {
  if (!markdown || !markdown.trim()) return markdown

  const sectionNames = new Set(
    (options?.sections ?? DEFAULT_BOILERPLATE_SECTIONS)
      .concat(options?.additionalSections ?? [])
      .map((s) => s.toLowerCase().trim()),
  )

  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown)

  // Find and remove boilerplate sections
  filterSectionsFromTree(tree, sectionNames, options?.enableHeuristic ?? false)

  // Stringify back to Markdown (remarkGfm registers table handlers;
  // without it, GFM table nodes throw "Cannot handle unknown node `table`")
  const result = unified()
    // Disable table column padding / pipe alignment on stringify to keep
    // sparse tables compact (same rationale as sanitize.service.ts).
    .use(remarkGfm, { tableCellPadding: false, tablePipeAlign: false })
    .use(remarkStringify, {
      bullet: '-',
      fences: true,
      listItemIndent: 'one',
    })
    .stringify(tree)

  return result.trim()
}

/**
 * Removes boilerplate sections from the AST in-place.
 */
function filterSectionsFromTree(
  tree: Root,
  sectionNames: Set<string>,
  enableHeuristic: boolean,
): void {
  if (!tree.children || tree.children.length === 0) return

  const newChildren: BlockContent[] = []
  let skipUntilLevel = -1 // -1 means not skipping; otherwise, skip until heading at this level or higher (lower number)

  for (let i = 0; i < tree.children.length; i++) {
    const node = tree.children[i]!

    if (node.type === 'heading') {
      const heading = node as Heading
      const level = heading.depth

      // Check if we should stop skipping (encountered a heading at same or higher level)
      if (skipUntilLevel >= 0 && level <= skipUntilLevel) {
        skipUntilLevel = -1
      }

      // If we're not skipping, check if this is a boilerplate section
      if (skipUntilLevel < 0) {
        const rawHeadingText = extractHeadingText(heading)
        const normalizedText = normalizeHeadingText(rawHeadingText)
        const headingText = normalizedText.toLowerCase().trim()

        // Check if this is a boilerplate section
        if (sectionNames.has(headingText)) {
          skipUntilLevel = level
          continue
        }

        // Check heuristic if enabled
        if (enableHeuristic && isBoilerplateByHeuristic(tree, i, level)) {
          skipUntilLevel = level
          continue
        }

        // Not boilerplate - keep this heading
        newChildren.push(node as BlockContent)
      }
    } else if (skipUntilLevel < 0) {
      // Keep non-heading nodes only if we're not skipping
      newChildren.push(node as BlockContent)
    }
    // If skipUntilLevel >= 0, skip this node
  }

  tree.children = newChildren
}

/**
 * Extracts plain text from a heading node.
 */
function extractHeadingText(heading: Heading): string {
  const parts: string[] = []

  const extractText = (node: any): void => {
    if (node.type === 'text' && node.value) {
      parts.push(node.value)
    } else if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        extractText(child)
      }
    }
  }

  extractText(heading)
  return parts.join(' ')
}

/**
 * Normalizes heading text for matching against boilerplate section names.
 * Strips common suffixes and attributes that don't affect the section identity:
 * - Edit markers like [edit], [editar], etc.
 * - Attribute blocks like {#custom-id} or {.class-name}
 * - Leading/trailing whitespace
 *
 * Preserves conservative behavior: only returns normalized text for matching,
 * doesn't add broad heuristics.
 */
function normalizeHeadingText(text: string): string {
  let normalized = text

  // Remove edit markers: [edit], [editar], [編集], etc.
  // Matches square brackets with word characters inside, typically at end
  normalized = normalized.replace(/\s*\[[\w\s]+\]\s*$/i, '')

  // Remove attribute blocks: {#id}, {.class}, {key=value}
  // Matches curly braces with various content patterns
  normalized = normalized.replace(/\s*\{[^}]*\}\s*$/i, '')

  return normalized.trim()
}

/**
 * Generic heuristic to detect boilerplate sections.
 * Conservative: only triggers if ALL conditions are met:
 * - Section is near document end (last 50% by node count)
 * - At least 3 content blocks in the full subtree
 * - At least 70% of blocks contain links
 * - At least 2 list items (indicates list/reference-heavy structure)
 * - At least 6 actual link nodes recursively across the full candidate subtree
 *
 * Content blocks include paragraphs, list items' content, and other block-level elements.
 * For lists, we count the content inside each list item (not the list item wrapper itself).
 * This ensures that mixed content (links + explanatory text) is properly evaluated.
 *
 * Analyzes the full subtree until a heading at same or higher level.
 * ENABLED for structured PDF/Markdown ingest - conservative enough to avoid false positives.
 */
function isBoilerplateByHeuristic(
  tree: Root,
  headingIndex: number,
  headingLevel: number,
): boolean {
  const totalNodes = tree.children.length
  const headingPosition = headingIndex / totalNodes

  // Must be in the last 50% of the document (by node count)
  if (headingPosition < 0.5) {
    return false
  }

  // Analyze the full subtree until next heading at same or higher level
  let linkBlockCount = 0
  let totalBlockCount = 0
  let listItemCount = 0
  let totalLinkCount = 0

  for (let i = headingIndex + 1; i < tree.children.length; i++) {
    const node = tree.children[i]!

    // Stop at next heading at same or higher level (lower number = higher level)
    if (node.type === 'heading') {
      const nextHeading = node as Heading
      if (nextHeading.depth <= headingLevel) {
        break
      }
    }

    // Count all link nodes recursively in this subtree node
    totalLinkCount += countLinks(node)

    // For lists, count content inside each list item as separate blocks
    // (not the list item wrapper itself)
    if (node.type === 'list') {
      const list = node as any
      const items = list.children ?? []
      for (const item of items) {
        listItemCount++
        // Count each child of the list item as a separate block
        if (item.children && Array.isArray(item.children)) {
          for (const child of item.children) {
            totalBlockCount++
            const hasLinks = containsLinks(child)
            if (hasLinks) {
              linkBlockCount++
            }
          }
        }
      }
    } else {
      // For other nodes, count as 1 block
      totalBlockCount++
      const hasLinks = containsLinks(node)
      if (hasLinks) {
        linkBlockCount++
      }
    }
  }

  // Need at least 3 content blocks
  if (totalBlockCount < 3) {
    return false
  }

  // Need >=70% blocks containing links
  const linkRatio = linkBlockCount / totalBlockCount
  if (linkRatio < 0.7) {
    return false
  }

  // Need at least 2 list items (indicates list/reference-heavy structure)
  if (listItemCount < 2) {
    return false
  }

  // Need at least 6 actual link nodes recursively across the full subtree
  // (prevents false positives on meaningful paragraphs with a few links)
  if (totalLinkCount < 6) {
    return false
  }

  return true
}

/**
 * Checks if a node contains links.
 */
function containsLinks(node: any): boolean {
  if (node.type === 'link') return true
  if (node.children && Array.isArray(node.children)) {
    return node.children.some((child: any) => containsLinks(child))
  }
  return false
}

/**
 * Counts all link nodes recursively within a node.
 */
function countLinks(node: any): number {
  let count = 0
  if (node.type === 'link') count++
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      count += countLinks(child)
    }
  }
  return count
}
