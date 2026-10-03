/**
 * Markdown normalization pipeline.
 *
 * Orchestrates the full normalization sequence for the Markdown route:
 *   1. Sanitize (conservative Unicode/whitespace cleanup)
 *   2. Filter malformed layout/sidebar blocks
 *   3. Filter boilerplate sections (References, Bibliography, etc.)
 *   4. Flatten inline markup (bold/italic/underline markers, link URLs)
 *
 * Output: canonical simplified Markdown — heading markers + plain body.
 * This is the text saved to `documentContents` and chunked by the Markdown chunker.
 * All offsets in chunks are relative to this normalized body.
 */

import { sanitize } from '../sanitize.service'
import { filterMalformedLayoutBlocks } from '../malformed-layout-filter.service'
import { filterBoilerplateSections } from '../section-filter.service'
import { flattenInlineMarkup } from './flatten-inline-markup.service'

/**
 * Normalizes Markdown through the full pipeline:
 * sanitize → filter malformed layout → filter boilerplate → flatten inline markup.
 *
 * Returns the canonical simplified Markdown body suitable for viewer display
 * and section-aware chunking.
 */
export function normalizeMarkdown(markdown: string): string {
  if (!markdown || !markdown.trim()) return markdown

  // 1. Conservative sanitize (Unicode normalization, whitespace cleanup)
  let text = sanitize(markdown)

  // 2. Filter malformed layout/sidebar blocks (Wikipedia infoboxes)
  text = filterMalformedLayoutBlocks(text)

  // 3. Filter boilerplate sections (References, Bibliography, etc.)
  text = filterBoilerplateSections(text, { enableHeuristic: true })

  // 4. Flatten inline markup (remove bold/italic/underline markers, link URLs)
  text = flattenInlineMarkup(text)

  return text
}
