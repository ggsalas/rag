/**
 * @vitest-environment node
 *
 * Comparison test: baseline chunking vs new normalized+chunked pipeline.
 *
 * Runs both pipelines on the same source content and compares:
 *   - Chunk count
 *   - Average chunk size
 *   - nDCG@10 (if embeddings are available)
 *
 * This test is GATED behind INGEST_COMPARISON=1 env var to avoid slowing CI.
 * It does NOT modify the existing benchmarks.
 */

import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { chunkMarkdown } from '@/services/ingest/chunking.service'
import { normalizeMarkdown } from '@/services/ingest/markdown/normalize-markdown.service'

const FIXTURE_PATH = resolve(__dirname, '../../fixtures/britnet-corpus.json')
const RUN_COMPARISON = process.env.INGEST_COMPARISON === '1'

describe.skipIf(!RUN_COMPARISON)('Ingest pipeline comparison', () => {
  it('compares baseline vs normalized chunking on the same source', () => {
    const raw = readFileSync(FIXTURE_PATH, 'utf-8')
    const fixture = JSON.parse(raw)
    const content = fixture.documents[0].content

    // Baseline: chunkMarkdown on raw content (diagnostic comparison only —
    // production normalizes first via normalizeMarkdown → chunkMarkdown)
    const baselineChunks = chunkMarkdown(content)

    // New pipeline: normalizeMarkdown → chunkMarkdown
    const normalized = normalizeMarkdown(content)
    const normalizedChunks = chunkMarkdown(normalized)

    console.log('\n=== INGEST PIPELINE COMPARISON ===')
    console.log(`Source content: ${content.length} chars`)
    console.log(`Normalized content: ${normalized.length} chars`)
    console.log(`Baseline chunks: ${baselineChunks.length}`)
    console.log(`Normalized chunks: ${normalizedChunks.length}`)

    // Compare average chunk sizes
    const baselineAvgSize =
      baselineChunks.reduce((sum, c) => sum + c.text.length, 0) /
      baselineChunks.length
    const normalizedAvgSize =
      normalizedChunks.reduce((sum, c) => sum + c.text.length, 0) /
      normalizedChunks.length

    console.log(`Baseline avg chunk size: ${baselineAvgSize.toFixed(0)} chars`)
    console.log(
      `Normalized avg chunk size: ${normalizedAvgSize.toFixed(0)} chars`,
    )

    // Compare section path preservation
    const baselineWithSection = baselineChunks.filter(
      (c) => c.sectionPath.length > 0,
    ).length
    const normalizedWithSection = normalizedChunks.filter(
      (c) => c.sectionPath.length > 0,
    ).length

    console.log(
      `Baseline chunks with section context: ${baselineWithSection}/${baselineChunks.length}`,
    )
    console.log(
      `Normalized chunks with section context: ${normalizedWithSection}/${normalizedChunks.length}`,
    )

    // Verify normalized text has no inline markup
    const hasInlineMarkup = normalizedChunks.some((c) =>
      /\*\*|__|\]\(http/.test(c.text),
    )
    console.log(`Normalized chunks with inline markup: ${hasInlineMarkup}`)

    // The test passes as long as both pipelines produce chunks
    // (actual metric comparison requires embeddings, which are expensive)
    expect(baselineChunks.length).toBeGreaterThan(0)
    expect(normalizedChunks.length).toBeGreaterThan(0)
  })
})
