/**
 * @vitest-environment node
 *
 * Controlled A/B comparison: raw pipeline vs normalized candidate pipeline.
 *
 * Compares on identical Britney source with same ranking settings:
 *   A) Raw pipeline: chunkMarkdown(rawContent)
 *   B) Candidate: chunkMarkdown(normalizeMarkdown(rawContent))
 *
 * Both use current production Orama settings (tokenizer/weights), same embeddings
 * model, queries, and ranking. Reports nDCG@10, Hit@10, Recall@10 and per-query deltas.
 *
 * GATED: only runs when PIPELINE_COMPARISON=1 env var is set.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { create, insert, search, type AnyOrama } from '@orama/orama'
import { resolve } from 'node:path'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  POSITIVE_CASES_V2,
  NEGATIVE_CASES_V2,
} from './search-benchmark.dataset.v2'
import type { GradedBenchmarkCase, BenchmarkChunk } from './search-benchmark.types'
import { relevanceVector } from './search-benchmark.relevance'
import {
  ndcgAtK,
  hitAtKGraded,
  recallAtKGraded,
} from './search-benchmark.ndcg'
import { chunkMarkdown } from '@/services/ingest/chunking.service'
import { normalizeMarkdown } from '@/services/ingest/markdown/normalize-markdown.service'
import { ENGLISH_STOP_WORDS_ARRAY } from '@/lib/stop-words'
import {
  EMBEDDING_DIMENSIONS,
  DEFAULT_HYBRID_WEIGHTS,
  ORAMA_LEXICAL_THRESHOLD,
} from '@/lib/constants'
import type { SearchResult } from '@/types/search'

const FIXTURE_PATH = resolve(__dirname, '../../fixtures', 'britnet-corpus.json')
const CACHE_DIR = resolve(__dirname, '../../fixtures', '.pipeline-comparison-cache')
const RAW_EMBEDDINGS_CACHE = resolve(CACHE_DIR, 'raw-chunks-embeddings.json')
const NORMALIZED_EMBEDDINGS_CACHE = resolve(CACHE_DIR, 'normalized-chunks-embeddings.json')
const QUERY_EMBEDDINGS_CACHE = resolve(CACHE_DIR, 'query-embeddings.json')

/** Gated behind env var so normal CI stays fast */
const RUN_PIPELINE_COMPARISON = process.env.PIPELINE_COMPARISON === '1'

// Production Orama config (matches current search.service.ts)
const PRODUCTION_ORAMA = {
  stemming: true,
  stopWords: true,
  threshold: ORAMA_LEXICAL_THRESHOLD,
}

type ChunkShape = {
  chunkId: string
  documentId: string
  documentName: string
  text: string
  searchText: string
  sectionPath: string[]
  headingText: string
  chunkIndex: number
}

function loadSourceContent(): string {
  const raw = readFileSync(FIXTURE_PATH, 'utf-8')
  const fixture = JSON.parse(raw)
  return fixture.documents[0].content
}

function chunkRaw(content: string, documentId: string, documentName: string): ChunkShape[] {
  // Pipeline A: raw chunkMarkdown (no normalization)
  const chunked = chunkMarkdown(content)
  return chunked.map((c, i) => ({
    chunkId: `raw::${documentId}::${i}`,
    documentId,
    documentName,
    text: c.text,
    searchText: c.searchText,
    sectionPath: c.sectionPath,
    headingText: c.headingText,
    chunkIndex: i,
  }))
}

function chunkNormalized(content: string, documentId: string, documentName: string): ChunkShape[] {
  // Pipeline B: normalizeMarkdown → chunkMarkdown (candidate)
  const normalized = normalizeMarkdown(content)
  const chunked = chunkMarkdown(normalized)
  return chunked.map((c, i) => ({
    chunkId: `norm::${documentId}::${i}`,
    documentId,
    documentName,
    text: c.text,
    searchText: c.searchText,
    sectionPath: c.sectionPath,
    headingText: c.headingText,
    chunkIndex: i,
  }))
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const { pipeline } = await import('@huggingface/transformers')
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    dtype: 'fp32',
  })

  const results: number[][] = []
  for (const t of texts) {
    const output = await extractor(t, { pooling: 'mean', normalize: true })
    results.push(Array.from(output.data as Float32Array))
  }
  return results
}

function computeChunksHash(chunks: ChunkShape[]): string {
  const hash = createHash('sha256')
  for (const chunk of chunks) {
    hash.update(chunk.text)
    hash.update(chunk.searchText)
    hash.update(chunk.sectionPath.join('|'))
    hash.update(chunk.headingText)
    hash.update('|')
  }
  return hash.digest('hex').slice(0, 16)
}

function computeQueriesHash(queries: string[]): string {
  const hash = createHash('sha256')
  for (const query of queries) {
    hash.update(query)
    hash.update('|')
  }
  return hash.digest('hex').slice(0, 16)
}

async function getOrGenerateEmbeddings(
  chunks: ChunkShape[],
  cachePath: string,
  label: string,
): Promise<number[][]> {
  const contentHash = computeChunksHash(chunks)

  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'))
    if (cached.hash === contentHash && cached.embeddings?.length === chunks.length) {
      return cached.embeddings
    }
    console.log(`  ${label} cache stale (hash or length mismatch), regenerating`)
  }

  console.log(`  Generating ${label} embeddings for ${chunks.length} chunks...`)
  const texts = chunks.map((c) => {
    const parts: string[] = []
    if (c.sectionPath.length > 0) parts.push(c.sectionPath.join(' > '))
    parts.push(c.searchText)
    return parts.join('\n')
  })
  const embeddings = await generateEmbeddings(texts)

  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(cachePath, JSON.stringify({ hash: contentHash, embeddings }))
  console.log(`  Cached ${label} embeddings (hash: ${contentHash})`)
  return embeddings
}

async function getOrGenerateQueryEmbeddings(queries: string[]): Promise<number[][]> {
  const contentHash = computeQueriesHash(queries)

  if (existsSync(QUERY_EMBEDDINGS_CACHE)) {
    const cached = JSON.parse(readFileSync(QUERY_EMBEDDINGS_CACHE, 'utf-8'))
    if (cached.hash === contentHash && cached.embeddings?.length === queries.length) {
      return cached.embeddings
    }
    console.log(`  Query cache stale, regenerating`)
  }

  console.log(`  Generating embeddings for ${queries.length} queries...`)
  const embeddings = await generateEmbeddings(queries)

  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(QUERY_EMBEDDINGS_CACHE, JSON.stringify({ hash: contentHash, embeddings }))
  return embeddings
}

async function createIndex(chunks: ChunkShape[], embeddings: number[][]): Promise<AnyOrama> {
  const db = await create({
    schema: {
      chunkId: 'string',
      documentId: 'string',
      documentName: 'string',
      text: 'string',
      searchText: 'string',
      sectionPath: 'string[]',
      headingText: 'string',
      embedding: `vector[${EMBEDDING_DIMENSIONS}]`,
      chunkIndex: 'number',
    } as const,
    components: {
      tokenizer: {
        language: 'english',
        stemming: PRODUCTION_ORAMA.stemming,
        stopWords: PRODUCTION_ORAMA.stopWords ? ENGLISH_STOP_WORDS_ARRAY : undefined,
      },
    },
  })

  for (let i = 0; i < chunks.length; i++) {
    await insert(db, { ...chunks[i]!, embedding: embeddings[i]! })
  }
  return db
}

async function searchPipeline(
  db: AnyOrama,
  query: string,
  queryEmbedding: number[],
): Promise<SearchResult[]> {
  const results = await search(db, {
    mode: 'hybrid',
    term: query,
    vector: { value: queryEmbedding, property: 'embedding' },
    properties: ['searchText', 'headingText'],
    limit: 50,
    includeVectors: false,
    similarity: 0.0,
    hybridWeights: DEFAULT_HYBRID_WEIGHTS,
    threshold: PRODUCTION_ORAMA.threshold,
  })

  return results.hits.map((hit) => ({
    chunkId: hit.document.chunkId as string,
    documentId: hit.document.documentId as string,
    documentName: hit.document.documentName as string,
    text: hit.document.text as string,
    searchText: hit.document.searchText as string,
    sectionPath: (hit.document.sectionPath as string[]) ?? [],
    headingText: (hit.document.headingText as string) ?? '',
    score: hit.score,
    chunkIndex: hit.document.chunkIndex as number,
  }))
}

describe.skipIf(!RUN_PIPELINE_COMPARISON)('Pipeline A/B Comparison', () => {
  let rawChunks: ChunkShape[]
  let normalizedChunks: ChunkShape[]
  let rawEmbeddings: number[][]
  let normalizedEmbeddings: number[][]
  let queryEmbeddings: number[][]
  let rawDb: AnyOrama
  let normalizedDb: AnyOrama
  let positiveCases: GradedBenchmarkCase[]
  let negativeCases: GradedBenchmarkCase[]

  beforeAll(async () => {
    console.log('\n=== PIPELINE A/B COMPARISON ===\n')

    const content = loadSourceContent()
    console.log(`Source content: ${content.length} chars\n`)

    // Pipeline A: raw
    rawChunks = chunkRaw(content, 'doc1', 'britney.md')
    console.log(`Pipeline A (raw): ${rawChunks.length} chunks`)

    // Pipeline B: normalized
    normalizedChunks = chunkNormalized(content, 'doc1', 'britney.md')
    console.log(`Pipeline B (normalized): ${normalizedChunks.length} chunks\n`)

    // Generate embeddings
    rawEmbeddings = await getOrGenerateEmbeddings(rawChunks, RAW_EMBEDDINGS_CACHE, 'raw')
    normalizedEmbeddings = await getOrGenerateEmbeddings(
      normalizedChunks,
      NORMALIZED_EMBEDDINGS_CACHE,
      'normalized',
    )

    // Load queries
    positiveCases = POSITIVE_CASES_V2
    negativeCases = NEGATIVE_CASES_V2
    const allQueries = [...positiveCases, ...negativeCases].map((c) => c.query)

    queryEmbeddings = await getOrGenerateQueryEmbeddings(allQueries)

    // Create indexes
    console.log('\nCreating indexes...')
    rawDb = await createIndex(rawChunks, rawEmbeddings)
    normalizedDb = await createIndex(normalizedChunks, normalizedEmbeddings)
    console.log('Indexes created.\n')
  })

  it('compares nDCG@10, Hit@10, Recall@10 between raw and normalized pipelines', async () => {
    const rawResults: Array<{ ndcg: number; hit: number; recall: number }> = []
    const normalizedResults: Array<{ ndcg: number; hit: number; recall: number }> = []

    console.log('='.repeat(120))
    console.log('PIPELINE A/B COMPARISON (production Orama settings)')
    console.log('='.repeat(120))
    console.log('\nPER-QUERY RESULTS:\n')
    console.log('Case'.padEnd(30) + '| Raw nDCG | Norm nDCG | ΔnDCG  | Raw Hit | Norm Hit | ΔHit   | Raw Rec | Norm Rec | ΔRec')
    console.log('-'.repeat(120))

    for (let i = 0; i < positiveCases.length; i++) {
      const testCase = positiveCases[i]!
      const query = testCase.query
      const queryEmbedding = queryEmbeddings[i]!

      // Search both pipelines
      const rawSearchResults = await searchPipeline(rawDb, query, queryEmbedding)
      const normalizedSearchResults = await searchPipeline(normalizedDb, query, queryEmbedding)

      // Compute relevance vectors, then derive graded metrics
      const rawRels = relevanceVector(rawSearchResults as BenchmarkChunk[], testCase)
      const normRels = relevanceVector(normalizedSearchResults as BenchmarkChunk[], testCase)

      const rawNdgc = ndcgAtK(rawRels, 10)
      const rawHit = hitAtKGraded(rawRels, 10)
      const rawRecall = recallAtKGraded(rawRels, 10)

      const normNdgc = ndcgAtK(normRels, 10)
      const normHit = hitAtKGraded(normRels, 10)
      const normRecall = recallAtKGraded(normRels, 10)

      rawResults.push({ ndcg: rawNdgc, hit: rawHit, recall: rawRecall })
      normalizedResults.push({ ndcg: normNdgc, hit: normHit, recall: normRecall })

      const deltaNdgc = normNdgc - rawNdgc
      const deltaHit = normHit - rawHit
      const deltaRecall = normRecall - rawRecall

      console.log(
        testCase.id.padEnd(30) +
        `| ${rawNdgc.toFixed(4).padEnd(9)}| ${normNdgc.toFixed(4).padEnd(10)}| ${deltaNdgc >= 0 ? '+' : ''}${deltaNdgc.toFixed(4).padEnd(7)}| ` +
        `${rawHit.toFixed(4).padEnd(8)}| ${normHit.toFixed(4).padEnd(9)}| ${deltaHit >= 0 ? '+' : ''}${deltaHit.toFixed(4).padEnd(7)}| ` +
        `${rawRecall.toFixed(4).padEnd(8)}| ${normRecall.toFixed(4).padEnd(9)}| ${deltaRecall >= 0 ? '+' : ''}${deltaRecall.toFixed(4)}`,
      )
    }

    // Aggregate
    const avgRawNdgc = rawResults.reduce((sum, r) => sum + r.ndcg, 0) / rawResults.length
    const avgNormNdgc = normalizedResults.reduce((sum, r) => sum + r.ndcg, 0) / normalizedResults.length
    const avgRawHit = rawResults.reduce((sum, r) => sum + r.hit, 0) / rawResults.length
    const avgNormHit = normalizedResults.reduce((sum, r) => sum + r.hit, 0) / normalizedResults.length
    const avgRawRecall = rawResults.reduce((sum, r) => sum + r.recall, 0) / rawResults.length
    const avgNormRecall = normalizedResults.reduce((sum, r) => sum + r.recall, 0) / normalizedResults.length

    console.log('\n' + '='.repeat(120))
    console.log('AGGREGATE METRICS (positive queries only)')
    console.log('='.repeat(120))
    console.log(`Pipeline A (raw):        nDCG@10=${avgRawNdgc.toFixed(4)}  Hit@10=${avgRawHit.toFixed(4)}  Recall@10=${avgRawRecall.toFixed(4)}`)
    console.log(`Pipeline B (normalized): nDCG@10=${avgNormNdgc.toFixed(4)}  Hit@10=${avgNormHit.toFixed(4)}  Recall@10=${avgNormRecall.toFixed(4)}`)
    console.log(`Δ (normalized - raw):    nDCG@10=${(avgNormNdgc - avgRawNdgc).toFixed(4)}  Hit@10=${(avgNormHit - avgRawHit).toFixed(4)}  Recall@10=${(avgNormRecall - avgRawRecall).toFixed(4)}`)
    console.log('='.repeat(120))

    // Test passes as long as we have results (this is a diagnostic, not a pass/fail)
    expect(rawResults.length).toBe(positiveCases.length)
    expect(normalizedResults.length).toBe(positiveCases.length)
  })

  it('checks evidence coverage: which fragments appear in raw vs normalized chunks', () => {
    console.log('\n' + '='.repeat(120))
    console.log('EVIDENCE COVERAGE ANALYSIS')
    console.log('='.repeat(120))

    // Normalizer for fragment matching: NFC + whitespace collapse + lowercase
    // (same as search-benchmark.relevance.ts)
    const normalize = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()

    let totalFragments = 0
    let fragmentsInRaw = 0
    let fragmentsInNormalized = 0
    let fragmentsLost = 0

    const lostFragments: Array<{ caseId: string; fragmentIndex: number; fragmentText: string }> = []

    for (const testCase of positiveCases) {
      for (let fragIdx = 0; fragIdx < testCase.fragments.length; fragIdx++) {
        const fragment = testCase.fragments[fragIdx]!
        const fragmentText = fragment.text
        totalFragments++

        const normalizedFragment = normalize(fragmentText)

        // Check if fragment appears in raw chunks (normalized matching)
        const inRaw = rawChunks.some((chunk) =>
          normalize(chunk.text).includes(normalizedFragment) ||
          normalize(chunk.searchText).includes(normalizedFragment),
        )

        // Check if fragment appears in normalized chunks (normalized matching)
        const inNormalized = normalizedChunks.some((chunk) =>
          normalize(chunk.text).includes(normalizedFragment) ||
          normalize(chunk.searchText).includes(normalizedFragment),
        )

        if (inRaw) fragmentsInRaw++
        if (inNormalized) fragmentsInNormalized++

        if (inRaw && !inNormalized) {
          fragmentsLost++
          const displayText = fragmentText.slice(0, 100) + (fragmentText.length > 100 ? '...' : '')
          lostFragments.push({
            caseId: testCase.id,
            fragmentIndex: fragIdx,
            fragmentText: displayText,
          })
        }
      }
    }

    console.log(`\nTotal fragments: ${totalFragments}`)
    console.log(`Fragments in raw chunks: ${fragmentsInRaw} (${((fragmentsInRaw / totalFragments) * 100).toFixed(1)}%)`)
    console.log(`Fragments in normalized chunks: ${fragmentsInNormalized} (${((fragmentsInNormalized / totalFragments) * 100).toFixed(1)}%)`)
    console.log(`Fragments lost in normalization: ${fragmentsLost} (${((fragmentsLost / totalFragments) * 100).toFixed(1)}%)`)

    if (lostFragments.length > 0) {
      console.log('\nLost fragments:')
      for (const lost of lostFragments) {
        console.log(`  ${lost.caseId} [fragment ${lost.fragmentIndex}]: ${lost.fragmentText}`)
      }
    }

    console.log('='.repeat(120))

    // This is diagnostic - we expect some fragments may be lost due to boilerplate filtering
    // The question is whether the loss is acceptable or indicates a bug
  })
})
