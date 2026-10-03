import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import {
  loadCorpusFixture,
  corpusFixtureExists,
  fixtureToBenchmarkChunks,
} from '@/dev/corpus/corpus-fixture.loader'
import type { CorpusFixture } from '@/types/corpus-fixture'
import { POSITIVE_CASES_V2 } from './search-benchmark.dataset.v2'
import { resolveRelevance } from './search-benchmark.relevance'
import type { BenchmarkChunk } from './search-benchmark.types'

/**
 * Sanity test: verifies that every fragment in the v2 dataset is actually
 * present in the source fixture, both in the document content and in at least
 * one chunk's searchText.
 *
 * This catches drift between the dataset and the fixture: if the corpus is
 * re-exported with different content, or if a fragment was mistyped, the test
 * fails with a clear message.
 *
 * Skips cleanly if the fixture file is not present (e.g. in CI or fresh clones).
 */

const FIXTURE_PATH = resolve(
  __dirname,
  '../../fixtures',
  'britnet-corpus.json',
)

const fixtureAvailable = corpusFixtureExists(FIXTURE_PATH)

/** Normalizes a string for fragment matching: NFC + collapse whitespace + lowercase */
function normalize(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

describe('search-benchmark.dataset.v2 — sanity', () => {
  let fixture: CorpusFixture | null = null
  let chunks: BenchmarkChunk[] = []

  beforeAll(() => {
    if (!fixtureAvailable) return
    fixture = loadCorpusFixture(FIXTURE_PATH)
    if (fixture) {
      chunks = fixtureToBenchmarkChunks(fixture).map((c) => ({
        chunkId: c.chunkId,
        text: c.text,
        searchText: c.searchText,
      }))
    }
  })

  const conditionalDescribe = fixtureAvailable ? describe : describe.skip

  conditionalDescribe('fragment presence in source content', () => {
    it('every fragment is a substring of the document content (after normalization)', () => {
      if (!fixture) return
      const content = fixture.documents[0]?.content ?? ''
      const normalizedContent = normalize(content)
      const missing: string[] = []

      for (const case_ of POSITIVE_CASES_V2) {
        for (const fragment of case_.fragments) {
          const normalizedFragment = normalize(fragment.text)
          if (!normalizedContent.includes(normalizedFragment)) {
            missing.push(`[${case_.id}] "${fragment.text}"`)
          }
        }
      }

      expect(
        missing,
        `Fragments not found in document content:\n${missing.join('\n')}`,
      ).toEqual([])
    })
  })

  conditionalDescribe('fragment presence in chunk searchText', () => {
    it('every positive case has at least one relevant chunk in the current chunking', () => {
      if (!fixture || chunks.length === 0) return
      const casesWithoutRelevant: string[] = []

      for (const case_ of POSITIVE_CASES_V2) {
        const relevant = resolveRelevance(chunks, case_)
        if (relevant.length === 0) {
          casesWithoutRelevant.push(case_.id)
        }
      }

      expect(
        casesWithoutRelevant,
        `Cases with no relevant chunk in current chunking:\n${casesWithoutRelevant.join('\n')}`,
      ).toEqual([])
    })

    it('reports how many relevant chunks each positive case has', () => {
      if (!fixture || chunks.length === 0) return
      // This test always passes — it's a diagnostic that logs the counts.
      for (const case_ of POSITIVE_CASES_V2) {
        const relevant = resolveRelevance(chunks, case_)
        // eslint-disable-next-line no-console
        console.log(
          `[sanity] ${case_.id}: ${relevant.length} relevant chunk(s)`,
        )
        expect(relevant.length).toBeGreaterThan(0)
      }
    })
  })

  conditionalDescribe('dataset structure', () => {
    it('has 14 positive cases', () => {
      expect(POSITIVE_CASES_V2).toHaveLength(14)
    })

    it('every positive case has at least one fragment', () => {
      for (const c of POSITIVE_CASES_V2) {
        expect(c.fragments.length).toBeGreaterThan(0)
        expect(c.kind).toBe('positive')
      }
    })

    it('all case ids are unique', () => {
      const ids = POSITIVE_CASES_V2.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('all fragment grades are 1 or 2', () => {
      for (const c of POSITIVE_CASES_V2) {
        for (const f of c.fragments) {
          expect([1, 2]).toContain(f.grade)
        }
      }
    })
  })
})
