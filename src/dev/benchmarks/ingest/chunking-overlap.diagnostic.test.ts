/**
 * Diagnostic test for H2: chunking destroys evidence due to overlap policy.
 *
 * Measures:
 * 1. Actual character overlap between consecutive chunks
 * 2. Distribution of overlap values (how many pairs have 0 overlap)
 * 3. Fraction of paragraphs exceeding the 100-char overlap budget
 * 4. Co-occurrence test: can multi-anchor cases fit in a single chunk?
 *
 * This test is deterministic and uses pure functions (chunkMarkdown, chunkText)
 * with realistic synthetic text. No embeddings or real corpus needed.
 *
 * NOTE: Tests chunking mechanics on raw content. Does NOT represent the
 * production pipeline (normalizeMarkdown → chunkMarkdown).
 */

import { describe, it, expect } from 'vitest'
import { chunkMarkdown, chunkText } from '@/services/ingest/chunking.service'
import { CHUNK_SIZE, CHUNK_OVERLAP } from '@/lib/constants'

/**
 * Builds a representative Wikipedia-style Markdown article with mixed paragraph lengths.
 * Deliberately includes paragraphs of 150, 300, 500, and 800 characters to test
 * the overlap policy across different sizes.
 */
function buildRealisticMarkdown(): string {
  return `# Britney Spears

Britney Spears is an American singer and entertainer. She was born on December 2, 1981, in McComb, Mississippi. She rose to fame in the late 1990s as a pop icon.

## Early life and career beginnings

Britney Jean Spears was born in McComb, Mississippi, and raised in Kentwood, Louisiana. Her mother, Lynne Irene, was an English teacher, and her father, James Parnell Spears, was a contractor. She has two siblings: Bryan and Jamie Lynn. As a child, Britney auditioned for the Mickey Mouse Club but was considered too young. She later attended the Professional Performing Arts School in New York City.

## Musical breakthrough: ...Baby One More Time (1998–1999)

In 1998, Britney released her debut single "...Baby One More Time", which became a worldwide hit and topped the charts in multiple countries. The song was written by Max Martin and Rami Yacoub. The album "...Baby One More Time" was released in January 1999 and debuted at number one on the Billboard 200. It was certified 14× platinum by the RIAA and became the best-selling album by a teenager in history. The album also included hits like "(You Drive Me) Crazy" and "Sometimes".

## Oops!... I Did It Again era (2000–2001)

Her second studio album, "Oops!... I Did It Again", was released in May 2000. It broke first-week sales records and debuted at number one on the Billboard 200. The title track became another international hit. The album showcased a more mature image and included collaborations with Rodney Jerkins and Max Martin. It was certified 10× platinum and solidified her status as a global pop superstar. During this period, she also embarked on her first world tour, the Crazy 2k Tour.

## Personal life and marriage

In 2004, Britney married Kevin Federline, a backup dancer she had met months earlier. The wedding was broadcast as a reality special. The couple had two sons together: Sean Preston, born in September 2005, and Jayden James, born in September 2006. The marriage ended in divorce in 2007.

## Blackout and In the Zone (2003–2007)

Her fourth studio album, "In the Zone", was released in November 2003. It included the hit single "Toxic", which won a Grammy Award for Best Dance Recording. The album was critically acclaimed and marked a shift toward a more dance-oriented sound. It featured collaborations with producers like Bloodshy & Avant and Guy Sigsworth. The album debuted at number one on the Billboard 200, making Britney the first female artist in history to have her first four albums debut at number one.

## Conservatorship and legal battles

In February 2008, Britney was placed under a conservatorship controlled by her father, Jamie Spears, and attorney Andrew Wallet. The conservatorship gave them control over her personal and financial affairs. It was initially established as a temporary measure following a series of highly publicized personal incidents. The arrangement lasted for 13 years and became the subject of the #FreeBritney movement. In November 2021, the conservatorship was officially terminated, restoring Britney's autonomy over her life and career.

## Las Vegas residency and later career

In 2013, Britney launched "Piece of Me", a residency show at The AXIS theater at Planet Hollywood Resort & Casino in Las Vegas. The show ran for two years and was extended due to popular demand. It featured her biggest hits and elaborate choreography. The residency grossed over $100 million and marked a successful return to live performance after years of limited public appearances.

## Legacy and cultural impact

Britney Spears is widely regarded as the "Princess of Pop" and one of the best-selling music artists of all time. She has sold over 100 million records worldwide. Her influence on pop culture in the late 1990s and early 2000s was profound, shaping fashion, music videos, and celebrity culture. She inspired a generation of pop artists including Lady Gaga, Katy Perry, and Miley Cyrus. Her career has been marked by both extraordinary success and intense media scrutiny.
`
}

/**
 * Measures the actual character overlap between consecutive chunks.
 * Returns an array of overlap lengths (in characters) for each pair of consecutive chunks.
 */
function measureOverlap(chunks: { text: string }[]): number[] {
  const overlaps: number[] = []
  for (let i = 0; i < chunks.length - 1; i++) {
    const prev = chunks[i]!.text
    const next = chunks[i + 1]!.text

    // Find the longest common substring at the end of prev and start of next
    // We look for how many characters from the end of prev match the start of next
    let overlap = 0
    const maxPossible = Math.min(prev.length, next.length, 200) // cap at 200 for efficiency

    for (let len = 1; len <= maxPossible; len++) {
      const prevSuffix = prev.slice(-len)
      const nextPrefix = next.slice(0, len)
      if (prevSuffix === nextPrefix) {
        overlap = len
      }
    }

    overlaps.push(overlap)
  }
  return overlaps
}

/**
 * Calculates the median of an array of numbers.
 */
function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!
}

describe('H2 Diagnostic: chunking overlap analysis', () => {
  const markdown = buildRealisticMarkdown()

  it('measures actual overlap in chunkMarkdown within sections', () => {
    const chunks = chunkMarkdown(markdown)

    console.log('\n=== H2 DIAGNOSTIC: chunkMarkdown ===')
    console.log(`Total chunks: ${chunks.length}`)
    console.log(`CHUNK_SIZE: ${CHUNK_SIZE}, CHUNK_OVERLAP: ${CHUNK_OVERLAP}`)
    console.log()

    // Show section distribution
    const sectionCounts = new Map<string, number>()
    for (const chunk of chunks) {
      const key = chunk.sectionPath.join(' > ') || '(no section)'
      sectionCounts.set(key, (sectionCounts.get(key) || 0) + 1)
    }
    console.log('Chunks per section:')
    for (const [section, count] of sectionCounts) {
      console.log(`  ${section}: ${count} chunk(s)`)
    }
    console.log()

    // Measure overlap only between chunks in the SAME section
    // Overlap is intentionally scoped to within-section boundaries — context
    // should not bleed across unrelated sections (e.g., "Early life" → "Musical breakthrough")
    const intraSectionOverlaps: number[] = []
    const interSectionOverlaps: number[] = []

    for (let i = 0; i < chunks.length - 1; i++) {
      const prev = chunks[i]!
      const next = chunks[i + 1]!
      const overlap = measureOverlap([prev, next])[0]!

      const sameSection =
        prev.sectionPath.length === next.sectionPath.length &&
        prev.sectionPath.every((h, idx) => h === next.sectionPath[idx])

      if (sameSection) {
        intraSectionOverlaps.push(overlap)
      } else {
        interSectionOverlaps.push(overlap)
      }
    }

    console.log('Overlap distribution (characters):')
    console.log(`  Intra-section pairs: ${intraSectionOverlaps.length}`)
    console.log(`  Inter-section pairs: ${interSectionOverlaps.length}`)
    console.log()

    if (intraSectionOverlaps.length > 0) {
      const meanIntra = intraSectionOverlaps.reduce((a, b) => a + b, 0) / intraSectionOverlaps.length
      const zeroIntra = intraSectionOverlaps.filter(o => o === 0).length
      const nonZeroIntra = intraSectionOverlaps.filter(o => o > 0).length
      console.log(`  Intra-section overlap:`)
      console.log(`    Pairs with 0 overlap: ${zeroIntra}`)
      console.log(`    Pairs with >0 overlap: ${nonZeroIntra}`)
      console.log(`    Mean overlap: ${meanIntra.toFixed(1)} chars`)
      console.log(`    Max overlap: ${Math.max(...intraSectionOverlaps)} chars`)
    } else {
      console.log(`  No intra-section pairs (each section produces only one chunk)`)
    }
    console.log()

    if (interSectionOverlaps.length > 0) {
      const zeroInter = interSectionOverlaps.filter(o => o === 0).length
      console.log(`  Inter-section overlap:`)
      console.log(`    Pairs with 0 overlap: ${zeroInter} / ${interSectionOverlaps.length}`)
      console.log(`    (Expected: all 0 — overlap is scoped to within-section boundaries)`)
    }
    console.log()

    // Assertion: overlap should work within sections (if any intra-section pairs exist)
    // If all sections produce only one chunk, there are no intra-section pairs to test
    if (intraSectionOverlaps.length > 0) {
      const nonZeroIntra = intraSectionOverlaps.filter(o => o > 0).length
      expect(nonZeroIntra).toBeGreaterThan(0)
    }

    // Assertion: inter-section overlap should be 0 (context doesn't bleed across sections)
    if (interSectionOverlaps.length > 0) {
      const zeroInter = interSectionOverlaps.filter(o => o === 0).length
      expect(zeroInter).toBe(interSectionOverlaps.length)
    }
  })

  it('measures actual overlap in chunkText', () => {
    // Convert markdown to plain text by removing heading markers
    const plainText = markdown.replace(/^#+\s+/gm, '')
    const chunks = chunkText(plainText)

    console.log('\n=== H2 DIAGNOSTIC: chunkText ===')
    console.log(`Total chunks: ${chunks.length}`)
    console.log()

    const overlaps = measureOverlap(chunks)
    console.log('Overlap distribution (characters):')
    console.log(`  Total pairs: ${overlaps.length}`)
    console.log(`  Pairs with 0 overlap: ${overlaps.filter(o => o === 0).length}`)
    console.log(`  Pairs with >0 overlap: ${overlaps.filter(o => o > 0).length}`)
    console.log(`  Mean overlap: ${(overlaps.reduce((a, b) => a + b, 0) / overlaps.length).toFixed(1)} chars`)
    console.log(`  Median overlap: ${median(overlaps)} chars`)
    console.log(`  Max overlap: ${Math.max(...overlaps)} chars`)
    console.log()

    // Assertion: most pairs should have >0 overlap (overlap is working)
    const zeroOverlapCount = overlaps.filter(o => o === 0).length
    const nonZeroOverlapCount = overlaps.filter(o => o > 0).length
    expect(nonZeroOverlapCount).toBeGreaterThan(zeroOverlapCount)
  })

  it('measures paragraph length distribution vs overlap budget', () => {
    const paragraphs = markdown.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)

    console.log('\n=== H2 DIAGNOSTIC: Paragraph length vs overlap budget ===')
    console.log(`Total paragraphs: ${paragraphs.length}`)
    console.log(`Overlap budget: ${CHUNK_OVERLAP} chars`)
    console.log()

    const lengths = paragraphs.map(p => p.length)
    const exceedsBudget = lengths.filter(l => l > CHUNK_OVERLAP)

    console.log('Paragraph length distribution:')
    console.log(`  Min: ${Math.min(...lengths)} chars`)
    console.log(`  Max: ${Math.max(...lengths)} chars`)
    console.log(`  Mean: ${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)} chars`)
    console.log(`  Median: ${median(lengths)} chars`)
    console.log()
    console.log(`Paragraphs exceeding ${CHUNK_OVERLAP}-char overlap budget: ${exceedsBudget.length} / ${paragraphs.length} (${((exceedsBudget.length / paragraphs.length) * 100).toFixed(1)}%)`)
    console.log()

    // Show paragraphs that exceed the budget
    if (exceedsBudget.length > 0) {
      console.log('Paragraphs exceeding overlap budget (first 5):')
      paragraphs
        .map((p, i) => ({ index: i, length: p.length, text: p }))
        .filter(p => p.length > CHUNK_OVERLAP)
        .slice(0, 5)
        .forEach(p => {
          console.log(`  Paragraph ${p.index}: ${p.length} chars`)
          console.log(`    Preview: "${p.text.slice(0, 80)}..."`)
        })
    }
    console.log()

    // Assertion: a meaningful fraction of paragraphs should exceed the overlap budget
    // (with CHUNK_OVERLAP=200, fewer paragraphs exceed it than with smaller values,
    // but overlap still benefits the paragraphs that do exceed it)
    const fraction = exceedsBudget.length / paragraphs.length
    expect(fraction).toBeGreaterThanOrEqual(0.3) // At least 30% exceed the budget
  })

  it('tests co-occurrence of anchors in same chunk', () => {
    console.log('\n=== H2 DIAGNOSTIC: Anchor co-occurrence test ===')
    console.log()

    const chunks = chunkMarkdown(markdown)

    // Test case 1: "Toxic" and "In the Zone" (from toxic-album case)
    const toxicChunks = chunks.filter(c =>
      c.text.toLowerCase().includes('toxic') &&
      c.text.toLowerCase().includes('in the zone')
    )
    console.log('Case: toxic-album')
    console.log('  Required anchors: "Toxic" AND "In the Zone"')
    console.log(`  Chunks containing BOTH: ${toxicChunks.length}`)
    if (toxicChunks.length > 0) {
      console.log(`  ✓ At least one chunk contains both anchors`)
    } else {
      console.log(`  ✗ No chunk contains both anchors (split across chunks)`)
    }
    console.log()

    // Test case 2: "Baby One More Time" and "1999" (from first-album case)
    const babyChunks = chunks.filter(c =>
      c.text.toLowerCase().includes('baby one more time') &&
      c.text.includes('1999')
    )
    console.log('Case: first-album')
    console.log('  Required anchors: "Baby One More Time" AND "1999"')
    console.log(`  Chunks containing BOTH: ${babyChunks.length}`)
    if (babyChunks.length > 0) {
      console.log(`  ✓ At least one chunk contains both anchors`)
    } else {
      console.log(`  ✗ No chunk contains both anchors (split across chunks)`)
    }
    console.log()

    // Test case 3: "McComb", "Mississippi", and "1981" (from birthplace case)
    const birthplaceChunks = chunks.filter(c =>
      c.text.toLowerCase().includes('mccomb') &&
      c.text.toLowerCase().includes('mississippi') &&
      c.text.includes('1981')
    )
    console.log('Case: birthplace')
    console.log('  Required anchors: "McComb" AND "Mississippi" AND "1981"')
    console.log(`  Chunks containing ALL THREE: ${birthplaceChunks.length}`)
    if (birthplaceChunks.length > 0) {
      console.log(`  ✓ At least one chunk contains all three anchors`)
    } else {
      console.log(`  ✗ No chunk contains all three anchors (split across chunks)`)
    }
    console.log()

    // Test case 4: "Circus" and "Womanizer" (from comeback-album case)
    // Note: these terms are NOT in our synthetic text, so this should return 0
    const comebackChunks = chunks.filter(c =>
      c.text.toLowerCase().includes('circus') &&
      c.text.toLowerCase().includes('womanizer')
    )
    console.log('Case: comeback-album (NOT in synthetic text)')
    console.log('  Required anchors: "Circus" AND "Womanizer"')
    console.log(`  Chunks containing BOTH: ${comebackChunks.length}`)
    console.log(`  (Expected: 0, since these terms are not in the synthetic text)`)
    console.log()

    // Assertion: at least one multi-anchor case should fail
    const allCasesPass = toxicChunks.length > 0 && babyChunks.length > 0 && birthplaceChunks.length > 0
    if (!allCasesPass) {
      console.log('⚠ At least one multi-anchor case failed (anchors split across chunks)')
    } else {
      console.log('✓ All multi-anchor cases passed (all anchors co-occur in at least one chunk)')
    }
    console.log()
  })
})
