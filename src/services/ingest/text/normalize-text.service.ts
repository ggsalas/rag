/**
 * Text normalization for the plain-text route.
 *
 * TXT files receive whitespace/newline normalization ONLY:
 * - Collapse horizontal whitespace (tabs, multiple spaces) to single spaces
 * - Normalize line endings
 * - Collapse runs of 3+ blank lines to 2
 * - Trim leading/trailing whitespace
 *
 * No Markdown parsing, no heading inference, no citation stripping,
 * no boilerplate filtering. The text is treated as literal plain text.
 */

/**
 * Normalizes plain text: whitespace and newline cleanup only.
 * Never interprets Markdown syntax or infers structure.
 */
export function normalizeText(text: string): string {
  if (!text) return text

  return (
    text
      // Normalize line endings to LF
      .replace(/\r\n?/g, '\n')
      // Collapse horizontal whitespace (tabs, multiple spaces) to single spaces
      // but preserve newlines
      .replace(/[^\S\n]+/g, ' ')
      // Remove spaces at start/end of lines
      .replace(/^ +/gm, '')
      .replace(/ +$/gm, '')
      // Collapse 3+ consecutive newlines to 2 (one blank line)
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}
