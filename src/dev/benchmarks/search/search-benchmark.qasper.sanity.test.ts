import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { QASPER_POSITIVE_CASES } from './search-benchmark.dataset.qasper'

/**
 * Sanity test: verifies that every fragment in the QASPER dataset is actually
 * present in the source Markdown fixtures after NFC normalization and whitespace
 * collapsing.
 *
 * This catches drift between the dataset and the fixtures: if a fragment was
 * mistyped or the Markdown regeneration changes the text, the test fails.
 */

const FIXTURE_DIR = resolve(__dirname, '../../fixtures')

/** Normalizes a string for fragment matching: NFC + collapse whitespace + lowercase */
function normalize(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

describe('search-benchmark.dataset.qasper — sanity', () => {
  let combinedMarkdown = ''

  beforeAll(() => {
    const md1 = readFileSync(resolve(FIXTURE_DIR, 'qasper-1910_11471.md'), 'utf-8')
    const md2 = readFileSync(resolve(FIXTURE_DIR, 'qasper-1908_06606.md'), 'utf-8')
    combinedMarkdown = md1 + '\n' + md2
  })

  it('every fragment is a substring of the combined Markdown (after normalization)', () => {
    const normalizedMd = normalize(combinedMarkdown)
    const missing: string[] = []

    for (const case_ of QASPER_POSITIVE_CASES) {
      for (const fragment of case_.fragments) {
        const normalizedFragment = normalize(fragment.text)
        if (!normalizedFragment) continue
        if (!normalizedMd.includes(normalizedFragment)) {
          missing.push(`[${case_.id}] "${fragment.text.slice(0, 100)}..."`)
        }
      }
    }

    expect(
      missing,
      `Fragments not found in combined Markdown:\n${missing.join('\n')}`,
    ).toEqual([])
  })

  it('has 16 positive cases', () => {
    expect(QASPER_POSITIVE_CASES).toHaveLength(16)
  })

  it('every positive case has at least one fragment', () => {
    for (const c of QASPER_POSITIVE_CASES) {
      expect(c.fragments.length).toBeGreaterThan(0)
      expect(c.kind).toBe('positive')
    }
  })

  it('all case ids are unique', () => {
    const ids = QASPER_POSITIVE_CASES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all fragment grades are 2', () => {
    for (const c of QASPER_POSITIVE_CASES) {
      for (const f of c.fragments) {
        expect(f.grade).toBe(2)
      }
    }
  })

  it('reports fragment counts per case', () => {
    for (const case_ of QASPER_POSITIVE_CASES) {
      // eslint-disable-next-line no-console
      console.log(
        `[sanity] ${case_.id}: ${case_.fragments.length} fragment(s)`,
      )
      expect(case_.fragments.length).toBeGreaterThan(0)
    }
  })
})
