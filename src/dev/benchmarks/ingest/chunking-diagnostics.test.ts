/**
 * Diagnostic: chunking algorithm analysis on raw content.
 * NOTE: Tests chunking mechanics (overlap, section tracking) in isolation.
 * Does NOT represent the production pipeline (normalizeMarkdown → chunkMarkdown).
 */
import { describe, it } from 'vitest'
import { resolve } from 'node:path'
import { chunkMarkdown } from '@/services/ingest/chunking.service'
import {
  CORPUS_FIXTURES_DIR,
  loadCorpusFixture,
  corpusFixtureExists,
} from '@/dev/corpus/corpus-fixture.loader'

const FIXTURE_PATH = resolve(CORPUS_FIXTURES_DIR, 'britnet-corpus.json')

/**
 * Compute overlap between two strings: longest suffix of `a` that matches
 * a prefix of `b`, capped at `maxCheck` characters.
 */
function computeStringOverlap(a: string, b: string, maxCheck = 500): number {
  const limit = Math.min(a.length, b.length, maxCheck)
  for (let len = limit; len >= 1; len--) {
    if (a.endsWith(b.slice(0, len))) return len
  }
  return 0
}

interface MetricsResult {
  totalChunks: number
  textMin: number
  textMedian: number
  textMean: number
  textMax: number
  overSize: number
  over1500: number
  overTokenLimit: number
  searchTextOver1000: number
  searchTextEmpty: number
  searchTextUnder50: number
  zeroOverlapPairs: number
  totalPairs: number
  meanOverlap: number
  thematicBreaks: number
}

function computeMetrics(
  chunks: ReturnType<typeof chunkMarkdown>,
): MetricsResult {
  const textLens = chunks.map((c) => c.text.length)
  const searchTextLens = chunks.map((c) => c.searchText.length)

  const sorted = [...textLens].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!
  const mean = textLens.reduce((a, b) => a + b, 0) / textLens.length

  // all-MiniLM-L6-v2 truncates at 256 tokens (~4 chars/token for English)
  const CHAR_TOKEN_LIMIT = 256 * 4

  const overlaps: number[] = []
  for (let i = 1; i < chunks.length; i++) {
    overlaps.push(computeStringOverlap(chunks[i - 1]!.text, chunks[i]!.text))
  }

  const zeroOverlap = overlaps.filter((o) => o === 0).length
  const meanOverlap =
    overlaps.length > 0
      ? overlaps.reduce((a, b) => a + b, 0) / overlaps.length
      : 0

  const thematicBreaks = chunks.filter(
    (c) => c.text.trim() === '***' || c.text.trim() === '---',
  ).length

  return {
    totalChunks: chunks.length,
    textMin: Math.min(...textLens),
    textMedian: median,
    textMean: Math.round(mean),
    textMax: Math.max(...textLens),
    overSize: textLens.filter((l) => l > 900).length,
    over1500: textLens.filter((l) => l > 1500).length,
    overTokenLimit: textLens.filter((l) => l > CHAR_TOKEN_LIMIT).length,
    searchTextOver1000: searchTextLens.filter((l) => l > 1000).length,
    searchTextEmpty: searchTextLens.filter((l) => l === 0).length,
    searchTextUnder50: searchTextLens.filter((l) => l < 50).length,
    zeroOverlapPairs: zeroOverlap,
    totalPairs: overlaps.length,
    meanOverlap,
    thematicBreaks,
  }
}

function formatMetrics(label: string, m: MetricsResult): string {
  const lines = [
    `\n=== ${label} ===`,
    `Total chunks: ${m.totalChunks}`,
    `text length:  min ${m.textMin} | median ${m.textMedian} | mean ${m.textMean} | max ${m.textMax}`,
    `chunks with text > 900 (CHUNK_SIZE): ${m.overSize}/${m.totalChunks}`,
    `chunks with text > 1500: ${m.over1500}/${m.totalChunks}`,
    `chunks with text > 1024 (token limit): ${m.overTokenLimit}/${m.totalChunks}`,
    `chunks with searchText > 1000 chars: ${m.searchTextOver1000}/${m.totalChunks}`,
    `chunks with searchText empty: ${m.searchTextEmpty}/${m.totalChunks}`,
    `chunks with searchText < 50 chars: ${m.searchTextUnder50}/${m.totalChunks}`,
    `overlap real between consecutive: ${m.zeroOverlapPairs}/${m.totalPairs} pairs with 0, mean ${m.meanOverlap.toFixed(1)} chars`,
    `thematicBreak chunks (*** or ---): ${m.thematicBreaks}`,
  ]
  return lines.join('\n')
}

/**
 * Diagnostic test: measures chunking quality metrics on the real corpus fixture.
 * Compares the NEW chunking against the OLD (baseline) metrics captured before
 * the chunking rewrite.
 */
describe.skipIf(!corpusFixtureExists(FIXTURE_PATH))(
  'chunking diagnostics on real corpus',
  () => {
    it('prints before/after metrics table', () => {
      const fixture = loadCorpusFixture(FIXTURE_PATH)!
      const content = fixture.documents[0]!.content

      // Run NEW chunking
      const newChunks = chunkMarkdown(content)
      const newMetrics = computeMetrics(newChunks)

      // OLD (baseline) metrics — measured before the chunking rewrite with
      // CHUNK_SIZE=500, CHUNK_OVERLAP=100, no sentence splitting, no
      // thematicBreak filtering, whole-unit overlap.
      const oldMetrics: MetricsResult = {
        totalChunks: 104,
        textMin: 3,
        textMedian: 478,
        textMean: 930,
        textMax: 5101,
        overSize: 50,
        over1500: 23,
        overTokenLimit: 33,
        searchTextOver1000: 31,
        searchTextEmpty: 13,
        searchTextUnder50: 17,
        zeroOverlapPairs: 82,
        totalPairs: 103,
        meanOverlap: 5.4,
        thematicBreaks: 13,
      }

      console.log(formatMetrics('BEFORE (old chunking)', oldMetrics))
      console.log(formatMetrics('AFTER (new chunking)', newMetrics))

      // searchText length distribution for the new chunking
      const searchTextLens = newChunks.map((c) => c.searchText.length)
      const buckets = [0, 50, 100, 200, 500, 1000, 2000, 5000]
      console.log('\nsearchText length distribution (AFTER):')
      for (let i = 0; i < buckets.length; i++) {
        const lo = buckets[i]!
        const hi = buckets[i + 1] ?? Infinity
        const count = searchTextLens.filter(
          (l) => l >= lo && l < hi,
        ).length
        console.log(`  [${lo}, ${hi === Infinity ? '∞' : hi}): ${count}`)
      }
    })
  },
)
