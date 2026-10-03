/**
 * Flattens inline Markdown markup while preserving block structure and headings.
 *
 * Input: sanitized, filtered Markdown (AST structure intact).
 * Output: simplified Markdown where:
 *   - Heading markers (`#`, `##`, …) are preserved with plain text
 *   - Bold/italic/underline/strikethrough markers are removed (text kept)
 *   - Link destinations (URLs) are removed; visible link labels are preserved
 *   - Paragraph / list / table / code block boundaries are preserved
 *   - Inline code backticks are removed; code content is kept
 *   - Image nodes are omitted (alt text preserved if meaningful)
 *   - Citation markers ([1], [a], [1, 2], escaped \[n]) are removed from text
 *
 * The output is the canonical "normalized Markdown" body: heading lines plus
 * plain text, suitable for both viewer display and chunking.
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import { visit, SKIP } from 'unist-util-visit'
import type { Root, Text, Link, Image, InlineCode } from 'mdast'
import type { Plugin } from 'unified'

/**
 * Remark plugin that flattens inline markup in-place.
 *
 * Transforms:
 * - `emphasis` / `strong` / `delete` → splice children (text) in place
 * - `link` → replace with a text node containing the link label
 *   (citation markers are stripped from the label)
 * - `inlineCode` → replace with a text node containing the code value
 *   (bracket content inside code is preserved verbatim)
 * - `image` → remove (or replace with alt text if meaningful)
 * - `html` → strip inline formatting tags (<u>, <b>, <i>, etc.), keep text
 * - `text` → strip citation markers ([1], [a], [1, 2], escaped forms)
 *   while preserving meaningful bracketed content ([C++], [API], [foo bar])
 *
 * Block structure (headings, paragraphs, lists, tables, code blocks) is
 * preserved by the re-serializer. Fenced code block content is never
 * touched because `code` nodes carry a `value`, not text children.
 */
const flattenInlineMarkupPlugin: Plugin<[], Root> = () => {
  return (tree: Root) => {
    // Walk the tree and transform inline nodes
    visit(tree, (node, index, parent) => {
      if (index === undefined || !parent) return undefined

      switch (node.type) {
        case 'emphasis':
        case 'strong':
        case 'delete': {
          // Replace this node with its children (splicing them into the parent)
          const children = (node as any).children ?? []
          parent.children.splice(index, 1, ...children)
          // Return the index to re-visit from the same position (now holding
          // the first spliced child)
          return index
        }

        case 'link': {
          const link = node as Link
          // Extract plain text from link children, then strip citation
          // markers that may appear inside the label (e.g. "claim [1]")
          const label = stripCitations(extractTextFromChildren(link))
          const textNode: Text = { type: 'text', value: label }
          parent.children[index] = textNode
          return SKIP
        }

        case 'inlineCode': {
          const code = node as InlineCode
          // Preserve code content verbatim — do NOT strip citations from
          // bracket syntax like array[247] or map[a] inside code.
          // The replacement text node is not revisited (SKIP), so citations
          // inside code are safe from the text-node stripping pass.
          const textNode: Text = { type: 'text', value: code.value }
          parent.children[index] = textNode
          return SKIP
        }

        case 'text': {
          // Strip citation markers from ordinary text nodes. Remark has
          // already normalised escaped brackets (e.g. \[a\] → [a]) into
          // the text value, so the regex handles both raw and escaped forms.
          const textNode = node as Text
          textNode.value = stripCitations(textNode.value)
          return undefined
        }

        case 'image': {
          const img = node as Image
          if (img.alt && img.alt.trim().length > 0) {
            const textNode: Text = { type: 'text', value: img.alt }
            parent.children[index] = textNode
          } else {
            parent.children.splice(index, 1)
            return index
          }
          return SKIP
        }

        case 'html': {
          // Strip inline formatting HTML tags, preserve text content
          const htmlNode = node as any
          const htmlValue = htmlNode.value || ''
          const stripped = stripInlineHtmlTags(htmlValue)
          if (stripped.trim()) {
            const textNode: Text = { type: 'text', value: stripped }
            parent.children[index] = textNode
          } else {
            parent.children.splice(index, 1)
            return index
          }
          return SKIP
        }

        default:
          return undefined
      }
    })
  }
}

/**
 * Extracts concatenated plain text from a node's children.
 */
function extractTextFromChildren(node: { children?: any[] }): string {
  if (!node.children) return ''
  const parts: string[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      parts.push(child.value)
    } else if (child.children && Array.isArray(child.children)) {
      parts.push(extractTextFromChildren(child))
    }
  }
  return parts.join('')
}

/**
 * Strips inline HTML formatting tags while preserving text content.
 * Handles common inline tags: <u>, <b>, <i>, <em>, <strong>, <s>, <del>, <ins>, <mark>.
 * Block-level HTML tags are left unchanged (they should be handled at block level).
 */
function stripInlineHtmlTags(html: string): string {
  // Match opening and closing inline formatting tags
  const inlineTags = ['u', 'b', 'i', 'em', 'strong', 's', 'del', 'ins', 'mark']
  let result = html

  for (const tag of inlineTags) {
    // Remove opening tags: <tag>, <tag attr="value">
    const openTagRegex = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi')
    result = result.replace(openTagRegex, '')

    // Remove closing tags: </tag>
    const closeTagRegex = new RegExp(`</${tag}>`, 'gi')
    result = result.replace(closeTagRegex, '')
  }

  return result
}

/**
 * Strips inline citation markers from text while preserving meaningful
 * bracketed content like [C++], [API], or [Node.js].
 *
 * Removes:
 * - Numeric citations: [1], [6], [10], [1,2,3], [1-3], [1, 2, 3]
 * - Single-letter citations: [a], [b], [a, b]
 * - Escaped forms normalised by remark: \[a\] / \[6\] become [a] / [6]
 *   in text nodes before this function runs, so they are caught here.
 *
 * Preserves:
 * - Uppercase / mixed-case brackets: [C++], [API], [Node.js]
 * - Multi-word or multi-character brackets: [foo bar], [some reference]
 * - Bracket content originating from inline code (handled upstream by
 *   not running this function on inlineCode replacements).
 */
function stripCitations(text: string): string {
  return text
    .replace(/\[\d[\d,\s–-]*\]/g, '') // numeric: [1], [10], [1,2,3], [1-3]
    .replace(/\[[a-z](?:\s*,\s*[a-z])*\]/g, '') // letter: [a], [a, b]
    .replace(/ {2,}/g, ' ') // collapse leftover double spaces
}

/** Pre-built processor for flattening inline markup */
const flattenProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm, { tableCellPadding: false, tablePipeAlign: false })
  .use(flattenInlineMarkupPlugin)
  .use(remarkStringify, {
    bullet: '-',
    fences: true,
    listItemIndent: 'one',
    // Use _ for emphasis and * for strong — but since we're removing all
    // inline markup, these settings only matter for any remaining syntax.
    emphasis: '_',
    strong: '*',
  })

/**
 * Flattens inline Markdown markup: removes bold/italic/underline markers,
 * removes link URLs (keeps visible labels), removes inline code backticks,
 * and strips citation markers ([1], [a], [1, 2], escaped forms) from text
 * while preserving meaningful bracketed content ([C++], [API], [foo bar])
 * and bracket syntax inside code.
 * Preserves heading markers and block structure.
 */
export function flattenInlineMarkup(markdown: string): string {
  if (!markdown || !markdown.trim()) return markdown
  const result = String(flattenProcessor.processSync(markdown))
  return result.trim()
}
