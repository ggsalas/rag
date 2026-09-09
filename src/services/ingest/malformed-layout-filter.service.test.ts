import { describe, it, expect } from 'vitest'
import { filterMalformedLayoutBlocks } from './malformed-layout-filter.service'

describe('filterMalformedLayoutBlocks', () => {
  it('returns empty/whitespace input unchanged', () => {
    expect(filterMalformedLayoutBlocks('')).toBe('')
    expect(filterMalformedLayoutBlocks('   ')).toBe('   ')
  })

  it('removes a Wikipedia-style sidebar: 3+ consecutive headings + link-heavy content', () => {
    // Simulates LiteParse output for a Wikipedia infobox: a run of consecutive
    // H2 headings (one per infobox label, no content between them) followed by
    // the interleaved label/value lines that are mostly short and link-heavy.
    const input = `# JavaScript

JavaScript is a high-level programming language.

## History

JavaScript was created in 1995.

## Syntax

JavaScript supports multiple paradigms.

## Born
## Created by
## Designed by
## Standardized as
## Latest version
## Typing discipline
## Implementation
## Website

1995

[Brendan Eich](https://en.wikipedia.org/wiki/Brendan_Eich)

[Netscape](https://en.wikipedia.org/wiki/Netscape)

[ECMAScript](https://en.wikipedia.org/wiki/ECMAScript)

[ES2024](https://en.wikipedia.org/wiki/ECMAScript_version_history)

[Dynamic](https://en.wikipedia.org/wiki/Dynamic_typing)

[Mozilla](https://en.wikipedia.org/wiki/Mozilla)

[developer.mozilla.org](https://developer.mozilla.org/)

## History section resumes

More prose about JavaScript history here.`

    const out = filterMalformedLayoutBlocks(input)

    // The entire sidebar region must be removed:
    // - the consecutive headings (Born, Created by, Designed by, Standardized
    //   as, Latest version, Typing discipline, Implementation, Website)
    // - the link-heavy content that follows them
    expect(out).toContain('# JavaScript')
    expect(out).toContain('high-level programming language')
    expect(out).toContain('## History')
    expect(out).toContain('created in 1995')
    expect(out).toContain('## Syntax')
    expect(out).toContain('multiple paradigms')

    // Sidebar headings must be gone
    expect(out).not.toContain('## Born')
    expect(out).not.toContain('## Created by')
    expect(out).not.toContain('## Designed by')
    expect(out).not.toContain('## Standardized as')
    expect(out).not.toContain('## Latest version')
    expect(out).not.toContain('## Typing discipline')
    expect(out).not.toContain('## Implementation')
    expect(out).not.toContain('## Website')

    // Sidebar content (link values) must be gone
    expect(out).not.toContain('Brendan Eich')
    expect(out).not.toContain('ECMAScript')
    expect(out).not.toContain('developer.mozilla.org')

    // Content after the sidebar resumes correctly
    expect(out).toContain('## History section resumes')
    expect(out).toContain('More prose about JavaScript history')
  })

  it('removes sidebar with mostly short blocks even if link count is below 6', () => {
    // Sidebar where the content after the consecutive headings is made of very
    // short label/value pairs (no links). Should still be removed by the
    // "mostly short blocks" anomaly.
    const input = `# Article

Intro paragraph.

## Label A
## Label B
## Label C
## Label D
## Label E

Short value.

Another short.

Yet another.

More short.

Tiny.

## Normal section

This is a regular section with a full paragraph of prose that should be preserved.`

    const out = filterMalformedLayoutBlocks(input)

    expect(out).toContain('# Article')
    expect(out).toContain('Intro paragraph')
    expect(out).toContain('## Normal section')
    expect(out).toContain('regular section with a full paragraph')

    expect(out).not.toContain('## Label A')
    expect(out).not.toContain('## Label B')
    expect(out).not.toContain('## Label C')
    expect(out).not.toContain('## Label D')
    expect(out).not.toContain('## Label E')
    expect(out).not.toContain('Short value')
    expect(out).not.toContain('Another short')
  })

  it('preserves ordinary sections: single heading followed by content', () => {
    const input = `# Article

Intro.

## History

Some historical content with a few [links](url) and prose.

## Legacy

Legacy content here.`

    const out = filterMalformedLayoutBlocks(input)
    expect(out).toContain('# Article')
    expect(out).toContain('## History')
    expect(out).toContain('historical content')
    expect(out).toContain('## Legacy')
    expect(out).toContain('Legacy content')
  })

  it('preserves ordinary sections: headings separated by content', () => {
    // Multiple headings but each followed by a paragraph — NOT a consecutive
    // run, so nothing should be removed.
    const input = `# Main

Intro.

## Section A

Paragraph A.

## Section B

Paragraph B.

## Section C

Paragraph C.

## Section D

Paragraph D.`

    const out = filterMalformedLayoutBlocks(input)
    expect(out).toContain('## Section A')
    expect(out).toContain('## Section B')
    expect(out).toContain('## Section C')
    expect(out).toContain('## Section D')
    expect(out).toContain('Paragraph A')
    expect(out).toContain('Paragraph D')
  })

  it('preserves two consecutive headings (below threshold of 3)', () => {
    const input = `# Main

Intro.

## Heading A

## Heading B

Some content after the two consecutive headings.`

    const out = filterMalformedLayoutBlocks(input)
    expect(out).toContain('## Heading A')
    expect(out).toContain('## Heading B')
    expect(out).toContain('Some content after')
  })

  it('preserves "Designed by..." paragraph when not part of a heading run', () => {
    // Regression: a paragraph mentioning names with links (e.g. "Designed by
    // Brendan Eich at Netscape, standardized as ECMAScript") must NOT be
    // removed when it is ordinary prose, not part of a consecutive heading run.
    const input = `# JavaScript

JavaScript is a high-level programming language.

## History

JavaScript was designed by [Brendan Eich](https://example.com/eich) in 1995
while working at [Netscape](https://example.com/netscape). It was later
standardized as [ECMAScript](https://example.com/ecma) by Ecma International.

## Standards

The language continues to evolve through the [TC39](https://example.com/tc39)
committee with proposals reviewed at [regular meetings](https://example.com/meetings).`

    const out = filterMalformedLayoutBlocks(input)
    expect(out).toContain('JavaScript')
    expect(out).toContain('Brendan Eich')
    expect(out).toContain('Netscape')
    expect(out).toContain('ECMAScript')
    expect(out).toContain('## History')
    expect(out).toContain('## Standards')
  })

  it('preserves meaningful section with a few links even after a heading run of 2', () => {
    // Only 2 consecutive headings (below threshold) + link-heavy content.
    // Must NOT be removed.
    const input = `# Main

Intro.

## Heading A

## Heading B

- [Link 1](url1)
- [Link 2](url2)
- [Link 3](url3)
- [Link 4](url4)
- [Link 5](url5)
- [Link 6](url6)`

    const out = filterMalformedLayoutBlocks(input)
    expect(out).toContain('## Heading A')
    expect(out).toContain('## Heading B')
    expect(out).toContain('Link 1')
    expect(out).toContain('Link 6')
  })

  it('preserves 3+ consecutive headings when followed by normal prose', () => {
    // 3 consecutive headings but the content after is a normal long paragraph
    // (not short blocks, not link-heavy). Must NOT be removed.
    const input = `# Main

Intro paragraph with substantial content.

## Heading A

## Heading B

## Heading C

This is a perfectly normal paragraph that follows three consecutive headings.
It contains substantial prose with many words and sentences that make it clear
this is legitimate article content, not a malformed sidebar block. The text
goes on for several lines to ensure it exceeds any short-block threshold.`

    const out = filterMalformedLayoutBlocks(input)
    expect(out).toContain('## Heading A')
    expect(out).toContain('## Heading B')
    expect(out).toContain('## Heading C')
    expect(out).toContain('perfectly normal paragraph')
  })

  it('stops the malformed region at the next same-or-higher-level heading', () => {
    // The malformed sidebar should be dropped, but a later H2 section that
    // is legitimate must be preserved.
    const input = `# Article

Intro.

## Real Section

Prose here.

## Label1
## Label2
## Label3
## Label4
## Label5
## Label6

Short.

Also short.

More short.

Yet more short.

Tiny.

Even shorter.

## Real Section After

This must be preserved.`

    const out = filterMalformedLayoutBlocks(input)
    expect(out).toContain('## Real Section')
    expect(out).toContain('Prose here')
    expect(out).toContain('## Real Section After')
    expect(out).toContain('This must be preserved')

    expect(out).not.toContain('## Label1')
    expect(out).not.toContain('## Label6')
  })

  it('handles document with no headings', () => {
    const input = `Just a paragraph.

Another paragraph.`

    const out = filterMalformedLayoutBlocks(input)
    expect(out).toContain('Just a paragraph')
    expect(out).toContain('Another paragraph')
  })

  it('handles document where the entire content is a malformed region', () => {
    const input = `## A

## B

## C

Short.

Also short.

More short.`

    const out = filterMalformedLayoutBlocks(input)
    // All content removed — result should be empty
    expect(out.trim()).toBe('')
  })
})
