/**
 * Converts Markdown to plain text optimized for retrieval.
 *
 * Uses remark AST (not regex) to reliably extract text content:
 * - Headings: text only, no # markers
 * - Emphasis/strong/underline: text only
 * - Links: preserve visible label, remove URL
 * - Images: omit by default (alt text preserved if meaningful)
 * - Lists: retain item text, remove markers
 * - Tables: retain readable cell content
 * - Fenced code: retain code content without fences
 * - Normalize whitespace
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { visit, SKIP } from 'unist-util-visit'
import type { Text, Code, InlineCode, Image } from 'mdast'

/**
 * Extracts plain text from Markdown AST for retrieval purposes.
 * Preserves semantic content while removing formatting syntax.
 */
export function markdownToSearchText(markdown: string): string {
  if (!markdown || !markdown.trim()) return ''

  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown)

  const textParts: string[] = []

  // Walk the AST and extract text
  visit(tree, (node) => {
    switch (node.type) {
      case 'heading':
        // Extract heading text without # markers
        extractTextFromChildren(node, textParts)
        textParts.push('\n')
        return SKIP

      case 'paragraph':
        extractTextFromChildren(node, textParts)
        textParts.push('\n\n')
        return SKIP

      case 'text':
        // Text nodes are handled by their parents
        return undefined

      case 'emphasis':
      case 'strong':
      case 'delete':
        // Extract text from emphasis/strong/strikethrough
        extractTextFromChildren(node, textParts)
        return SKIP

      case 'link':
        // Preserve link text, ignore URL
        extractTextFromChildren(node, textParts)
        return SKIP

      case 'image':
        // Omit images by default, or preserve alt text if meaningful
        const img = node as Image
        if (img.alt && img.alt.trim().length > 0) {
          textParts.push(img.alt)
        }
        return SKIP

      case 'list':
        // Process list items
        extractTextFromChildren(node, textParts)
        return SKIP

      case 'listItem':
        extractTextFromChildren(node, textParts)
        textParts.push('\n')
        return SKIP

      case 'table':
        // Process table rows
        extractTextFromChildren(node, textParts)
        textParts.push('\n\n')
        return SKIP

      case 'tableRow':
        extractTextFromChildren(node, textParts)
        textParts.push('\n')
        return SKIP

      case 'tableCell':
        extractTextFromChildren(node, textParts)
        textParts.push(' | ')
        return SKIP

      case 'code':
        // Fenced code: preserve content without fences
        const code = node as Code
        if (code.value && code.value.trim()) {
          textParts.push(code.value)
          textParts.push('\n\n')
        }
        return SKIP

      case 'inlineCode':
        // Inline code: preserve content without backticks
        const inlineCode = node as InlineCode
        if (inlineCode.value) {
          textParts.push(inlineCode.value)
        }
        return SKIP

      case 'blockquote':
        extractTextFromChildren(node, textParts)
        return SKIP

      case 'thematicBreak':
        // Skip horizontal rules
        return SKIP

      case 'html':
        // Skip raw HTML
        return SKIP

      case 'yaml':
        // Skip frontmatter
        return SKIP

      default:
        // Let the visitor visit children naturally for unknown node types
        return undefined
    }
  })

  // Join and normalize whitespace
  return textParts
    .join('')
    .replace(/[ \t]+/g, ' ') // Collapse horizontal whitespace
    .replace(/ *\n */g, '\n') // Remove spaces around newlines
    .replace(/\n{3,}/g, '\n\n') // Collapse multiple blank lines
    .trim()
}

/**
 * Recursively extracts text from node children.
 */
function extractTextFromChildren(
  node: { children?: any[] },
  textParts: string[],
): void {
  if (!node.children) return

  for (const child of node.children) {
    if (child.type === 'text') {
      const text = child as Text
      if (text.value) {
        textParts.push(text.value)
      }
    } else if (child.type === 'inlineCode') {
      const code = child as InlineCode
      if (code.value) {
        textParts.push(code.value)
      }
    } else if (child.type === 'image') {
      // Preserve meaningful alt text
      const img = child as Image
      if (img.alt && img.alt.trim().length > 0) {
        textParts.push(img.alt)
      }
    } else if ('children' in child && Array.isArray(child.children)) {
      // Recursively extract from nested nodes
      extractTextFromChildren(child, textParts)
    }
  }
}
