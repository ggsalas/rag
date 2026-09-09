/**
 * Filters malformed layout/sidebar blocks from structured Markdown (typically
 * emitted by LiteParse from PDFs of Wikipedia-style articles).
 *
 * LiteParse sometimes produces a run of consecutive headings with no intervening
 * content (e.g. the infobox labels of a Wikipedia sidebar rendered as H2/H3),
 * followed by a block of interleaved labels/values/links. Indexing that region
 * pollutes search results with misleading fragment titles and link-heavy noise.
 *
 * Detection is intentionally conservative. A region is removed ONLY when ALL of
 * the following hold:
 *
 *   1. There is a run of at least {@link MIN_CONSECUTIVE_HEADINGS} (3) headings
 *      with NO non-heading block between any two of them.
 *   2. The content that follows the run — up to the next heading of the same or
 *      higher level (lower depth number) or document end — shows layout
 *      anomalies. "Layout anomalies" means AT LEAST ONE of:
 *        a) The region contains at least {@link MIN_LINK_COUNT} (6) link nodes
 *           AND at least {@link MIN_LINK_BLOCK_RATIO} (70%) of its content
 *           blocks contain a link (sidebar / infobox signature).
 *        b) The region is made mostly of very short blocks: at least
 *           {@link MIN_SHORT_BLOCK_RATIO} (70%) of its content blocks have a
 *           plain-text length below {@link SHORT_BLOCK_CHAR_LIMIT} (40) chars,
 *           which is typical of label/value pairs rather than prose.
 *   3. The run has at least one content block after it (otherwise there is no
 *      malformed payload to drop — the headings alone are kept).
 *
 * The entire region (the consecutive headings AND the malformed content that
 * follows them) is removed so no orphan titles remain in the stored viewer
 * Markdown or in indexed chunks.
 *
 * Ordinary article prose is preserved: a single heading followed by a paragraph
 * (even a link-heavy one), or a run of headings each separated by content, will
 * never match criterion (1).
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import type { Root, Heading, BlockContent, RootContent } from 'mdast'

/** Minimum number of consecutive headings (no content between) to consider. */
const MIN_CONSECUTIVE_HEADINGS = 3

/**
 * Minimum total link nodes in the content region for the "link-heavy" anomaly.
 * Mirrors the >=6 threshold used by the generic boilerplate heuristic in
 * section-filter.service.ts so behavior stays consistent.
 */
const MIN_LINK_COUNT = 6

/**
 * Minimum ratio of content blocks that must contain a link for the region to
 * qualify as "link-heavy". 0.7 == 70%.
 */
const MIN_LINK_BLOCK_RATIO = 0.7

/**
 * Minimum ratio of content blocks that must be "short" (plain-text length
 * below {@link SHORT_BLOCK_CHAR_LIMIT}) for the region to qualify as
 * "mostly short blocks" (sidebar label/value signature).
 */
const MIN_SHORT_BLOCK_RATIO = 0.7

/** Character limit below which a content block is considered "short". */
const SHORT_BLOCK_CHAR_LIMIT = 40

/**
 * Removes malformed layout/sidebar blocks from Markdown.
 * Returns cleaned Markdown. Safe to call on any Markdown — returns input
 * unchanged when no suspicious region is detected.
 */
export function filterMalformedLayoutBlocks(markdown: string): string {
  if (!markdown || !markdown.trim()) return markdown

  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown)

  const removed = removeMalformedRegions(tree)
  if (!removed) return markdown

  // Stringify back to Markdown (same pipeline as section-filter.service.ts
  // so formatting stays consistent across the ingest chain).
  const result = unified()
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
 * Scans the root children for malformed regions and removes them in-place.
 * Returns true if at least one region was removed.
 */
function removeMalformedRegions(tree: Root): boolean {
  if (!tree.children || tree.children.length === 0) return false

  const newChildren: BlockContent[] = []
  let removedAny = false
  let i = 0

  while (i < tree.children.length) {
    const node = tree.children[i]!

    // Detect a run of consecutive headings starting at position i
    if (node.type === 'heading') {
      const runStart = i
      let runEnd = i // exclusive, first non-heading index
      while (
        runEnd < tree.children.length &&
        tree.children[runEnd]!.type === 'heading'
      ) {
        runEnd++
      }
      const runLength = runEnd - runStart

      if (runLength >= MIN_CONSECUTIVE_HEADINGS) {
        // Determine the level of the first heading in the run. Content that
        // belongs to this "block" extends until the next heading at the same
        // or higher level (lower depth number).
        const firstHeading = tree.children[runStart] as Heading
        const stopLevel = firstHeading.depth

        let contentEnd = runEnd
        while (contentEnd < tree.children.length) {
          const n = tree.children[contentEnd]!
          if (n.type === 'heading') {
            const h = n as Heading
            if (h.depth <= stopLevel) break
          }
          contentEnd++
        }

        const contentBlockCount = contentEnd - runEnd

        // Only drop if there is content after the run AND that content is
        // anomalous. Otherwise keep everything untouched.
        if (
          contentBlockCount > 0 &&
          isContentAnomalous(tree.children, runEnd, contentEnd)
        ) {
          // Drop the entire region: headings + malformed content.
          i = contentEnd
          removedAny = true
          continue
        }
      }

      // Not a suspicious run — keep this heading and advance by one.
      newChildren.push(node as BlockContent)
      i++
    } else {
      newChildren.push(node as BlockContent)
      i++
    }
  }

  if (removedAny) {
    tree.children = newChildren
  }
  return removedAny
}

/**
 * Returns true if the slice of root children in [start, end) shows layout
 * anomalies typical of a malformed sidebar / infobox block.
 */
function isContentAnomalous(
  nodes: RootContent[],
  start: number,
  end: number,
): boolean {
  let totalBlocks = 0
  let linkBlocks = 0
  let shortBlocks = 0
  let totalLinks = 0

  for (let i = start; i < end; i++) {
    const node = nodes[i]!

    // For lists, count each list item's content children as individual blocks
    // (same convention as section-filter.service.ts) so list-heavy sidebars
    // are evaluated per-item rather than per-list.
    if (node.type === 'list') {
      const list = node as any
      const items = list.children ?? []
      for (const item of items) {
        if (item.children && Array.isArray(item.children)) {
          for (const child of item.children) {
            totalBlocks++
            const textLen = plainTextLength(child)
            const links = countLinks(child)
            totalLinks += links
            if (links > 0) linkBlocks++
            if (textLen < SHORT_BLOCK_CHAR_LIMIT) shortBlocks++
          }
        }
      }
    } else {
      totalBlocks++
      const textLen = plainTextLength(node)
      const links = countLinks(node)
      totalLinks += links
      if (links > 0) linkBlocks++
      if (textLen < SHORT_BLOCK_CHAR_LIMIT) shortBlocks++
    }
  }

  if (totalBlocks === 0) return false

  const linkBlockRatio = linkBlocks / totalBlocks
  const shortBlockRatio = shortBlocks / totalBlocks

  // Anomaly (a): link-heavy sidebar signature
  const linkHeavy =
    totalLinks >= MIN_LINK_COUNT && linkBlockRatio >= MIN_LINK_BLOCK_RATIO

  // Anomaly (b): mostly short blocks (label/value pairs)
  const mostlyShort = shortBlockRatio >= MIN_SHORT_BLOCK_RATIO

  return linkHeavy || mostlyShort
}

/** Plain-text character length of a node (links contribute their text). */
function plainTextLength(node: any): number {
  let len = 0
  const walk = (n: any): void => {
    if (n.type === 'text' && typeof n.value === 'string') {
      len += n.value.length
    }
    if (n.children && Array.isArray(n.children)) {
      for (const c of n.children) walk(c)
    }
  }
  walk(node)
  return len
}

/** Counts all link nodes recursively within a node. */
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
