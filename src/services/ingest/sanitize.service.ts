/**
 * Conservative markdown sanitizer.
 *
 * Cleans up text-extraction artifacts (Unicode compatibility variants, invisible
 * characters, whitespace noise) WITHOUT altering document structure. Never drops
 * or reshapes markdown nodes — headings, lists, tables, links, code blocks, and
 * frontmatter survive intact. Content inside `code`, `inlineCode`, `html`, and
 * `yaml` nodes is treated as verbatim and left completely untouched.
 *
 * For aggressive noise removal (Wikipedia nav chrome, empty tables, citation
 * markers, image data-URLs, etc.) see `boilerplate-stripper.service.ts` — that
 * module is opt-in and NOT called by the default ingest pipeline.
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import { visit, SKIP } from 'unist-util-visit'
import type { Plugin } from 'unified'
import type { Root, Text, TableCell } from 'mdast'

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
 * Normalizes Unicode in a text node value:
 * - NFKC to fold Unicode compatibility variants (ligatures like `ﬁ` → `fi`,
 *   full-width digits → half-width, etc.)
 * - Strip zero-width joiners / BOM
 * - Convert NBSP to a regular space so word boundaries tokenize normally
 *
 * Applied only to non-verbatim `text` nodes so code blocks, inline code,
 * HTML, and frontmatter remain untouched.
 */
function normalizeTextValue(value: string): string {
  return value
    .normalize('NFKC')
    .replace(INVISIBLE_CHARS_RE, '')
    .replace(/ /g, ' ')
}

/**
 * unified plugin: applies conservative in-place transforms to `text` nodes
 * outside verbatim contexts, and trims text inside table cells. No node is
 * ever removed or reshaped by this plugin.
 */
const sanitizePlugin: Plugin<[], Root> = () => {
  return (tree) => {
    // Visitor A — normalize Unicode + collapse whitespace inside text nodes,
    // respecting verbatim contexts (code blocks, inline code, HTML, etc.).
    visit(tree, 'text', (node: Text, _index, parent) => {
      if (parent && VERBATIM_NODE_TYPES.has(parent.type)) return SKIP
      const normalized = normalizeTextValue(node.value)
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
      if (normalized !== node.value) node.value = normalized
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

    // Visitor C — placeholder for hyphenation repair (`docu-\nment` → `document`).
    // Not activated: needs a proper heuristic to distinguish PDF line-break
    // hyphenation from legitimate hyphenated words like "co-operative". Add here
    // when we have measured evidence and can pin a safe rule.
    // repairHyphenation(tree)
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
 * document structure. Idempotent. Verbatim content (code blocks, inline code,
 * HTML, frontmatter) is preserved untouched.
 */
export function sanitize(text: string): string {
  if (!text) return text
  // Unicode normalization is applied in the visitor to non-verbatim text nodes,
  // so code blocks and inline code retain their original content.
  const out = String(processor.processSync(text))
  return out.trim()
}
