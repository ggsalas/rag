/**
 * Markdown sanitizer.
 *
 * Cleans up text-extraction artifacts (Unicode compatibility variants, invisible
 * characters, whitespace noise) and removes non-content metadata that adds noise
 * to retrieval:
 *   - Links: `link` and `linkReference` nodes are replaced by their label
 *     children. The URL/reference is metadata, not human-facing content, and
 *     leaving it embedded pollutes vector embeddings and BM25 tokenization
 *     (URLs contain thousands of ambient tokens like "wikipedia", "html", etc).
 *
 * Structural content — headings, lists, tables, code blocks, frontmatter — is
 * preserved intact. Contents inside `code`, `inlineCode`, `html`, `yaml`,
 * `toml`, `math` are treated as verbatim source and untouched.
 *
 * For aggressive noise removal that also drops nodes (nav chrome, citation
 * markers, image data-URLs, etc.) see `boilerplate-stripper.service.ts` —
 * opt-in and NOT called by the default ingest pipeline.
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import { visit, SKIP } from 'unist-util-visit'
import type { Plugin } from 'unified'
import type { Root, Text, TableCell, Parent, RootContent } from 'mdast'

/**
 * Node types whose content is treated as verbatim source. Visitors that
 * transform text MUST NOT descend into these — modifying their contents would
 * corrupt code samples, embedded HTML, or frontmatter.
 */
const VERBATIM_NODE_TYPES = new Set([
  'code',
  'inlineCode',
  'html',
  'yaml',
  'toml',
  'math',
  'inlineMath',
])

/** Zero-width and BOM characters that pollute BM25 tokenization */
const INVISIBLE_CHARS_RE = /[​‌‍﻿]/g

/**
 * Pre-parse string normalization:
 * - NFKC to fold Unicode compatibility variants (ligatures like `ﬁ` → `fi`,
 *   full-width digits → half-width, etc.)
 * - Strip zero-width joiners / BOM
 * - Convert NBSP to a regular space so word boundaries tokenize normally
 */
function normalizeUnicode(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE_CHARS_RE, '')
    .replace(/ /g, ' ')
}

/**
 * unified plugin: applies in-place transforms to text nodes, trims text inside
 * table cells, and unwraps link/linkReference nodes (replacing them with their
 * label children). Verbatim contexts (code blocks, inline code, HTML, YAML,
 * TOML, math) are never traversed.
 */
const sanitizePlugin: Plugin<[], Root> = () => {
  return (tree) => {
    // Visitor A — collapse whitespace inside text nodes, respecting verbatim contexts.
    visit(tree, 'text', (node: Text, _index, parent) => {
      if (parent && VERBATIM_NODE_TYPES.has(parent.type)) return SKIP
      const collapsed = node.value
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
      if (collapsed !== node.value) node.value = collapsed
      return undefined
    })

    // Visitor B — trim leading/trailing whitespace on the text nodes inside table cells.
    // Preserves cell structure; only removes noisy padding.
    visit(tree, 'tableCell', (cell: TableCell) => {
      if (!cell.children || cell.children.length === 0) return
      const first = cell.children[0]
      const last = cell.children[cell.children.length - 1]
      if (first && first.type === 'text') {
        first.value = first.value.replace(/^\s+/, '')
      }
      if (last && last.type === 'text') {
        last.value = last.value.replace(/\s+$/, '')
      }
    })

    // Visitor C — unwrap link and linkReference nodes: replace them with their
    // label children in the parent's child list. This keeps the human-facing
    // label (e.g. "Baby One More Time (1999)") and drops the URL metadata that
    // would otherwise pollute embeddings and BM25 tokenization.
    visit(tree, (node, index, parent) => {
      if (index === undefined || !parent) return
      if (node.type !== 'link' && node.type !== 'linkReference') return
      // Both `link` and `linkReference` have `children` of PhrasingContent.
      const parentTyped = parent as Parent
      const label = (node as { children: RootContent[] }).children
      parentTyped.children.splice(index, 1, ...(label as never[]))
      // Continue traversal from the same index (children may contain nested links).
      return index
    })

    // Visitor D — remove definition nodes (`[ref]: url` at the tail of docs).
    // Once linkReferences are unwrapped (Visitor C), these become orphan
    // metadata and never render as content. Removing them prevents URL tokens
    // from leaking into embeddings and BM25.
    visit(tree, 'definition', (_node, index, parent) => {
      if (index === undefined || !parent) return
      const parentTyped = parent as Parent
      parentTyped.children.splice(index, 1)
      return index
    })
  }
}

/** Pre-built processor (built once at module load so plugins register only once) */
const processor = unified()
  .use(remarkParse)
  // Disable table column padding / pipe alignment on stringify: a single wide
  // cell in a column would otherwise pad every other cell to match, exploding
  // tables with sparse rows (~20× size increase on Wikipedia exports).
  .use(remarkGfm, { tableCellPadding: false, tablePipeAlign: false })
  .use(sanitizePlugin)
  .use(remarkStringify, {
    bullet: '-',
    fences: true,
    listItemIndent: 'one',
    emphasis: '_',
    strong: '*',
    rule: '-',
  })

/**
 * Conservative sanitize: normalizes Unicode + whitespace without altering
 * document structure. Idempotent.
 */
export function sanitize(text: string): string {
  if (!text) return text
  const normalized = normalizeUnicode(text)
  const out = String(processor.processSync(normalized))
  return out.trim()
}
