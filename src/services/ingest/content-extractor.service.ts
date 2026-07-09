import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import { toString } from 'mdast-util-to-string'
import type { Root, RootContent, Heading } from 'mdast'

/**
 * Extracts main article content from a parsed markdown document by dropping
 * boilerplate sections (References, See also, External links, Notes, etc.)
 * that commonly appear at the end of Wikipedia-style dumps and academic PDFs.
 *
 * Inspired by tools like `markdowncleaner` (Python) — implemented on top of the
 * unified/remark AST already used elsewhere in the pipeline. Runs between
 * `sanitize()` and the chunker so downstream steps only see substantive content.
 *
 * Behavior:
 *   1. Parse the input into an mdast Root.
 *   2. Walk the root's top-level children in order.
 *   3. When a `heading` whose text matches the blacklist is found, drop that
 *      heading and every subsequent node — including nested subsections —
 *      until another heading of equal or shallower depth appears.
 *   4. Everything else survives untouched.
 *   5. Stringify the surviving nodes back to markdown with deterministic options.
 */

/**
 * Default section-name blacklist. Case-insensitive comparison against the
 * plain-text heading label. Ordered by language then alphabetically.
 */
export const DEFAULT_BOILERPLATE_SECTIONS = new Set<string>([
  // English
  'acknowledgements',
  'acknowledgments',
  'bibliography',
  'citations',
  'endnotes',
  'external links',
  'footnotes',
  'further reading',
  'notes',
  'references',
  'related articles',
  'see also',
  'sources',
  // Spanish
  'agradecimientos',
  'artículos relacionados',
  'bibliografía',
  'citas',
  'enlaces externos',
  'fuentes',
  'lectura adicional',
  'notas',
  'notas al pie',
  'referencias',
  'véase también',
])

export interface ExtractOptions {
  /** Override the default heading blacklist. Values must be lowercase. */
  boilerplateSections?: Set<string>
}

const parser = unified().use(remarkParse).use(remarkGfm)

const stringifier = unified()
  .use(remarkGfm, { tableCellPadding: false, tablePipeAlign: false })
  .use(remarkStringify, {
    bullet: '-',
    fences: true,
    listItemIndent: 'one',
    emphasis: '_',
    strong: '*',
    rule: '-',
  })

/**
 * Removes boilerplate sections from a markdown document by heading name.
 * Idempotent. If the document has no matching sections, returns effectively
 * the same content (modulo remark-stringify canonicalization).
 */
export function extractMainContent(
  markdown: string,
  options?: ExtractOptions,
): string {
  if (!markdown) return ''

  const boilerplate =
    options?.boilerplateSections ?? DEFAULT_BOILERPLATE_SECTIONS

  const tree = parser.parse(markdown) as Root

  const kept: RootContent[] = []
  let skippingLevel: number | null = null

  for (const node of tree.children) {
    if (node.type !== 'heading') {
      if (skippingLevel === null) kept.push(node)
      continue
    }

    const heading = node as Heading
    const label = toString(heading).trim().toLowerCase()

    if (skippingLevel !== null) {
      // Exit skip mode when we hit a heading at the same or shallower level;
      // the boilerplate subtree is now behind us. Re-evaluate this heading
      // against the blacklist in case one boilerplate section is immediately
      // followed by another (e.g. "## References" → "## External links").
      if (heading.depth <= skippingLevel) {
        skippingLevel = null
      } else {
        continue
      }
    }

    if (boilerplate.has(label)) {
      skippingLevel = heading.depth
      continue
    }

    kept.push(heading)
  }

  const newTree: Root = { type: 'root', children: kept }
  return String(stringifier.stringify(newTree)).trim()
}
