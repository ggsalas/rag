/**
 * Removes boilerplate and web/wiki chrome from parsed text before chunking.
 *
 * Wikipedia exports, PDF-to-markdown output, and other converted documents commonly
 * contain nav menus, language link lists, empty markdown-table skeletons, inline
 * citation markers, escaped markdown punctuation, image-reference data URLs, and
 * paragraphs wrapped in `[text](url)` link syntax. All of these pollute embeddings
 * and BM25 tokenization. This module strips them so the downstream chunker sees
 * only substantive content.
 */

const NAV_LABELS = new Set([
  'Main menu',
  'Navigation',
  'Contribute',
  'Tools',
  'Actions',
  'General',
  'Personal tools',
  'Appearance',
  'Print/export',
  'In other projects',
  'Contents',
  'Edit links',
  'FALSE',
  'TRUE',
  '(Top)',
  'Sheet1',
])

/** Removes inline citation markers like [12], [12][13], [12][13][14] */
function stripCitations(text: string): string {
  return text.replace(/\[\d+\](?:\[\d+\])*/g, '')
}

/**
 * Unwraps markdown links `[label](url)` → `label`. The label regex treats
 * `\]` as an escaped bracket rather than a terminator, so labels containing
 * escaped brackets (common in Wikipedia exports) unwrap correctly.
 */
function unwrapLinks(text: string): string {
  return text.replace(
    /\[((?:\\.|[^\]])+)\]\((?:[^()]|\([^)]*\))*\)/g,
    '$1',
  )
}

/** Removes markdown images: ![alt](url) and reference-style ![alt][ref] */
function stripImages(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, '')
}

/**
 * Removes leftover parenthesized URLs from unwrap failures — cases where the
 * label was malformed and the standard unwrap couldn't match. Targets absolute
 * URLs, protocol-relative URLs, mail links, and same-page anchors.
 */
function stripOrphanUrls(text: string): string {
  return text.replace(
    /\((?:https?:|mailto:|\/\/|\/wiki\/|#)[^)\s]*(?:\s+"[^"]*")?\)/g,
    '',
  )
}

/**
 * Removes markdown image-reference DEFINITIONS at line start:
 * `[ref]: url` or `[ref]: data:image/png;base64,...`.
 * These are the huge data-URL blocks Wikipedia PDF exports pack at the tail.
 */
function stripImageRefDefinitions(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*\[[^\]]+\]:\s*(?:data:|https?:|\/\/|\/)/.test(line))
    .join('\n')
}

/** Un-escapes markdown-escaped punctuation: `\(` → `(`, `\]` → `]`, etc. */
function unescapePunctuation(text: string): string {
  return text.replace(/\\([\[\]()|*_.\-!#])/g, '$1')
}

/**
 * Returns true when a string is a pure markdown link with a *short* label — the
 * signature of nav / language-list links. Long-labeled or sentence-terminated
 * labels are treated as wrapped paragraphs and preserved.
 */
function isPureShortLink(s: string): boolean {
  const m = s
    .trim()
    .match(/^\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)$/)
  if (!m) return false
  const label = m[1]!.trim()
  if (label.length > 80) return false
  if (/[.!?]\s*$/.test(label)) return false
  return true
}

/**
 * Returns true when a table row's only non-empty cell is a pure short link, e.g.
 * `|[Main page](/wiki/Main_Page)| | |` — a very common Wikipedia-export pattern.
 */
function isTableRowOfNavLink(line: string): boolean {
  if (!line.includes('|')) return false
  const cells = line
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
  if (cells.length !== 1) return false
  return isPureShortLink(cells[0]!)
}

/** True when the line is a markdown table row containing no content (pipes/whitespace only) */
function isEmptyTableRow(line: string): boolean {
  if (!line.includes('|')) return false
  const stripped = line.replace(/[|\s\-:]/g, '')
  return stripped.length === 0
}

/** True when the line is a markdown table separator like `|---|---|` */
function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line)
}

/** True when the line, aside from possible `#` heading marks, contains no alphanumerics */
function isPureSymbolLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (trimmed.length < 4) return false
  const alnum = trimmed.match(/[\p{L}\p{N}]/gu)?.length ?? 0
  return alnum / trimmed.length < 0.2
}

/**
 * Collapses immediate doubling: "Main menuMain menu" → "Main menu",
 * "Main menu Main menu" → "Main menu", "ToolsTools" → "Tools".
 * Tries both a character-level split and a word-level split; only returns a
 * collapsed value when both halves match exactly.
 */
function collapseDoubledString(s: string): string {
  const t = s.trim()
  if (t.length < 6) return s

  // Character-level halving (handles concatenated repetition without spaces).
  if (t.length % 2 === 0) {
    const half = t.length / 2
    const a = t.slice(0, half)
    const b = t.slice(half)
    if (a === b && /[\p{L}]/u.test(a)) return a
  }

  // Word-level halving (handles space-separated repetition).
  const words = t.split(/\s+/)
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2
    const first = words.slice(0, half).join(' ')
    const second = words.slice(half).join(' ')
    if (first === second && /[\p{L}]/u.test(first)) return first
  }

  return s
}

/** Extracts heading label if the line is a markdown heading; otherwise returns line as-is */
function headingText(line: string): string {
  const m = line.match(/^\s*#{1,6}\s+(.+?)\s*$/)
  return m ? m[1]! : line
}

/** True when the line — after collapse and heading-stripping — matches a known nav label */
function isNavLabel(line: string): boolean {
  const bare = collapseDoubledString(headingText(line).trim())
  return NAV_LABELS.has(bare.trim())
}

/** Removes table cell delimiters, converting `| a | b | c |` into `a b c` */
function flattenTableRow(line: string): string {
  if (!line.includes('|')) return line
  return line.replace(/^\s*\|\s*|\s*\|\s*$/g, '').replace(/\s*\|\s*/g, ' ')
}

/**
 * Sanitizes text (markdown or plain) by removing boilerplate that pollutes embeddings.
 * Idempotent: safe to call more than once.
 */
export function sanitize(text: string): string {
  if (!text) return text

  // Pass A — structural drops that must run before inline transforms.
  let cleaned = stripImageRefDefinitions(text)
  const passA: string[] = []
  for (const line of cleaned.split('\n')) {
    if (isPureShortLink(line)) continue
    if (isTableRowOfNavLink(line)) continue
    if (isEmptyTableRow(line)) continue
    if (isTableSeparator(line)) continue
    passA.push(line)
  }
  cleaned = passA.join('\n')

  // Pass B — inline content transforms. Order matters: citations first (they
  // contain `]` that would confuse the link unwrap regex), then images, then
  // links (with the smart escape-aware regex), then leftover URL cleanup, then
  // unescape markdown punctuation.
  cleaned = stripCitations(cleaned)
  cleaned = stripImages(cleaned)
  cleaned = unwrapLinks(cleaned)
  cleaned = stripOrphanUrls(cleaned)
  cleaned = unescapePunctuation(cleaned)

  // Pass C — flatten table cells, collapse doubled strings, drop nav / symbol lines.
  const passC: string[] = []
  for (const raw of cleaned.split('\n')) {
    const flat = flattenTableRow(raw)
    const collapsed = collapseDoubledString(flat)
    if (isNavLabel(collapsed)) continue
    if (isPureSymbolLine(collapsed)) continue
    passC.push(collapsed)
  }
  cleaned = passC.join('\n')

  // Pass D — whitespace normalization.
  cleaned = cleaned.replace(/[ \t]+/g, ' ')
  cleaned = cleaned.replace(/ *\n */g, '\n')
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')

  return cleaned.trim()
}
