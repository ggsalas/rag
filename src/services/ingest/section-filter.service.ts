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

  // Stringify back to Markdown
  const result = unified()
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
        const headingText = extractHeadingText(heading).toLowerCase().trim()

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
 * Generic heuristic to detect boilerplate sections.
 * Conservative: only triggers if ALL conditions are met:
 * - Section is near document end (last 50% by node count)
 * - At least 3 content blocks in the full subtree (list items count as separate blocks)
 * - At least 70% of blocks contain links
 * - At least 2 list items (indicates list/reference-heavy structure)
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

  console.log(
    'DEBUG: Checking heuristic for heading at index',
    headingIndex,
    'level',
    headingLevel,
  )
  console.log('DEBUG: Total nodes:', totalNodes, 'Position:', headingPosition)

  // Must be in the last 50% of the document (by node count)
  if (headingPosition < 0.5) {
    console.log('DEBUG: Position < 0.5, returning false')
    return false
  }

  // Analyze the full subtree until next heading at same or higher level
  // Count list items as separate blocks (reference sections are typically a single list with multiple items)
  let linkBlockCount = 0
  let totalBlockCount = 0
  let listItemCount = 0

  for (let i = headingIndex + 1; i < tree.children.length; i++) {
    const node = tree.children[i]!

    // Stop at next heading at same or higher level (lower number = higher level)
    if (node.type === 'heading') {
      const nextHeading = node as Heading
      if (nextHeading.depth <= headingLevel) {
        console.log('DEBUG: Found heading at same/higher level, stopping')
        break
      }
    }

    // For lists, count each list item as a separate block
    if (node.type === 'list') {
      const list = node as any
      const items = list.children ?? []
      console.log('DEBUG: Found list with', items.length, 'items')
      for (const item of items) {
        totalBlockCount++
        listItemCount++
        const hasLinks = containsLinks(item)
        console.log('DEBUG: List item has links:', hasLinks)
        if (hasLinks) {
          linkBlockCount++
        }
      }
    } else {
      // For other nodes, count as 1 block
      totalBlockCount++
      const hasLinks = containsLinks(node)
      console.log('DEBUG: Node type', node.type, 'has links:', hasLinks)
      if (hasLinks) {
        linkBlockCount++
      }
    }
  }

  console.log(
    'DEBUG: totalBlockCount:',
    totalBlockCount,
    'linkBlockCount:',
    linkBlockCount,
    'listItemCount:',
    listItemCount,
  )

  // Need at least 3 content blocks (list items count)
  if (totalBlockCount < 3) {
    console.log('DEBUG: totalBlockCount < 3, returning false')
    return false
  }

  // Need >=70% blocks containing links
  const linkRatio = linkBlockCount / totalBlockCount
  console.log('DEBUG: linkRatio:', linkRatio)
  if (linkRatio < 0.7) {
    console.log('DEBUG: linkRatio < 0.7, returning false')
    return false
  }

  // Need at least 2 list items (indicates list/reference-heavy structure)
  if (listItemCount < 2) {
    console.log('DEBUG: listItemCount < 2, returning false')
    return false
  }

  console.log('DEBUG: All conditions met, returning true')
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
