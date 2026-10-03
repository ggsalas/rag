/**
 * @vitest-environment node
 *
 * Hybrid benchmark with REAL embeddings — v2 (graded ground truth).
 *
 * Uses the fragment-based graded ground truth from search-benchmark.dataset.v2.ts.
 * Primary metric: nDCG@10. Also reports Hit@10 and Recall@10.
 *
 * Six conditions on the same source content:
 *   A: 104 old chunks + old Orama config (no stemming, no stopwords, threshold=1.0)
 *   B: 104 old chunks + new Orama config (stemming, stopwords, threshold=0.5)
 *   C: 166 new chunks + old Orama config
 *   D: 166 new chunks + new Orama config (current repo state)
 *   E: 166 new chunks + new tokenizer (stemming+stopwords) + threshold=1.0  ← KEY
 *   F: 166 new chunks + new tokenizer (stemming+stopwords) + threshold=0.3
 *
 * Condition E isolates the tokenizer effect from the threshold effect.
 * If E ≥ C in nDCG@10, the tokenizer adds value and we should revert threshold to 1.0.
 *
 * Also reports:
 *   - Vector-only A vs D (isolates embedding truncation fix effect)
 *   - Negative queries: result count per condition (false positive proxy)
 *   - Overlap diagnostics (with correct suffix-prefix algorithm)
 *
 * GATED: only runs when HYBRID_BENCHMARK=1 env var is set.
 * Embeddings are cached to disk to avoid recomputation.
 */

import { describe, it, beforeAll } from 'vitest'
import { create, insert, search, type AnyOrama } from '@orama/orama'
import { resolve } from 'node:path'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  POSITIVE_CASES_V2,
  NEGATIVE_CASES_V2,
} from './search-benchmark.dataset.v2'
import type { GradedBenchmarkCase } from './search-benchmark.types'
import { relevanceVector, chunkRelevanceGrade } from './search-benchmark.relevance'
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
  DEFAULT_MIN_SCORE,
  MIN_ABSOLUTE_SCORE,
  MIN_QUERY_LEXICAL_COVERAGE,
} from '@/lib/constants'
import { rankByLexicalRelevance, computeLexicalCoverage } from '@/lib/lexical-ranking'
import type { SearchResult } from '@/types/search'

const FIXTURE_PATH = resolve(__dirname, '../../fixtures', 'britnet-corpus.json')
const EMBEDDINGS_CACHE_DIR = resolve(__dirname, '../../fixtures', '.embedding-cache')
const OLD_EMBEDDINGS_CACHE = resolve(EMBEDDINGS_CACHE_DIR, 'old-chunks-embeddings.json')
const NEW_EMBEDDINGS_CACHE = resolve(EMBEDDINGS_CACHE_DIR, 'new-chunks-embeddings.json')
const QUERY_EMBEDDINGS_CACHE = resolve(EMBEDDINGS_CACHE_DIR, 'query-embeddings.json')

/** Gated behind env var so normal `vitest run` stays fast */
const RUN_HYBRID_BENCHMARK = process.env.HYBRID_BENCHMARK === '1'

type OramaConfig = {
  stemming: boolean
  stopWords: boolean
  threshold: number
}

const OLD_ORAMA: OramaConfig = {
  stemming: false,
  stopWords: false,
  threshold: 1.0,
}

const NEW_ORAMA: OramaConfig = {
  stemming: true,
  stopWords: true,
  threshold: 0.5,
}

/** Condition E: new tokenizer but threshold=1.0 (isolates tokenizer effect) */
const TOKENIZER_ONLY_ORAMA: OramaConfig = {
  stemming: true,
  stopWords: true,
  threshold: 1.0,
}

/** Condition F: new tokenizer + threshold=0.3 (more aggressive pruning) */
const AGGRESSIVE_THRESHOLD_ORAMA: OramaConfig = {
  stemming: true,
  stopWords: true,
  threshold: 0.3,
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

/**
 * Replicates buildEmbeddingText from ingest.service.ts.
 * sectionPath joined by ' > ', then '\n', then searchText.
 */
function buildEmbeddingText(chunk: {
  searchText: string
  sectionPath: string[]
}): string {
  const parts: string[] = []
  if (chunk.sectionPath.length > 0) {
    parts.push(chunk.sectionPath.join(' > '))
  }
  parts.push(chunk.searchText)
  return parts.join('\n')
}

function loadRawContent(): { content: string; documentId: string; documentName: string } {
  const raw = readFileSync(FIXTURE_PATH, 'utf-8')
  const fixture = JSON.parse(raw)
  const doc = fixture.documents[0]
  return {
    content: doc.content as string,
    documentId: doc.meta.id as string,
    documentName: doc.meta.name as string,
  }
}

function loadOldChunks(): ChunkShape[] {
  const raw = readFileSync(FIXTURE_PATH, 'utf-8')
  const fixture = JSON.parse(raw)
  const doc = fixture.documents[0]
  return doc.chunks.map((c: any) => ({
    chunkId: `${doc.meta.id}::${c.chunkIndex}`,
    documentId: doc.meta.id,
    documentName: doc.meta.name,
    text: c.text,
    searchText: c.searchText,
    sectionPath: c.sectionPath,
    headingText: c.headingText,
    chunkIndex: c.chunkIndex,
  }))
}

function rechunkNew(content: string, documentId: string, documentName: string): ChunkShape[] {
  // Apply target normalization pipeline before chunking (matches production ingest)
  const normalized = normalizeMarkdown(content)
  const chunked = chunkMarkdown(normalized)
  return chunked.map((c, i) => ({
    chunkId: `new::${documentId}::${i}`,
    documentId,
    documentName,
    text: c.text,
    searchText: c.searchText,
    sectionPath: c.sectionPath,
    headingText: c.headingText,
    chunkIndex: i,
  }))
}

/**
 * Generates embeddings using @huggingface/transformers in Node.
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const { pipeline } = await import('@huggingface/transformers')
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    dtype: 'fp32',
  })

  const results: number[][] = []
  for (let i = 0; i < texts.length; i++) {
    const output = await extractor(texts[i]!, { pooling: 'mean', normalize: true })
    const embedding = Array.from(output.data as Float32Array)
    results.push(embedding)
  }
  return results
}

/**
 * Computes a deterministic hash of chunk texts for cache validation.
 * This ensures cache invalidation when content changes, even if chunk count stays the same.
 */
function computeChunksHash(chunks: ChunkShape[]): string {
  const hash = createHash('sha256')
  for (const chunk of chunks) {
    hash.update(chunk.text)
    hash.update(chunk.searchText)
    hash.update(chunk.sectionPath.join('|'))
    hash.update(chunk.headingText)
    hash.update('|')
  }
  return hash.digest('hex').slice(0, 16) // Use first 16 chars for brevity
}

/**
 * Computes a deterministic hash of query texts for cache validation.
 */
function computeQueriesHash(queries: string[]): string {
  const hash = createHash('sha256')
  for (const query of queries) {
    hash.update(query)
    hash.update('|')
  }
  return hash.digest('hex').slice(0, 16)
}

/**
 * Loads or generates embeddings for chunks, with disk caching.
 * Uses content hash to detect when chunk content has changed.
 */
async function getOrGenerateEmbeddings(
  chunks: ChunkShape[],
  cachePath: string,
  label: string,
): Promise<number[][]> {
  const contentHash = computeChunksHash(chunks)

  if (existsSync(cachePath)) {
    console.log(`  Loading cached ${label} embeddings from ${cachePath}`)
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'))
    if (cached.hash === contentHash && cached.embeddings?.length === chunks.length) {
      return cached.embeddings
    }
    console.log(`  Cache stale (hash or length mismatch), regenerating`)
  }

  console.log(`  Generating ${label} embeddings for ${chunks.length} chunks...`)
  const texts = chunks.map((c) => buildEmbeddingText(c))
  const embeddings = await generateEmbeddings(texts)

  if (!existsSync(EMBEDDINGS_CACHE_DIR)) {
    mkdirSync(EMBEDDINGS_CACHE_DIR, { recursive: true })
  }
  writeFileSync(cachePath, JSON.stringify({ hash: contentHash, embeddings }))
  console.log(`  Cached ${label} embeddings to ${cachePath} (hash: ${contentHash})`)
  return embeddings
}

/**
 * Loads or generates embeddings for queries, with disk caching.
 * Uses content hash to detect when query texts have changed.
 */
async function getOrGenerateQueryEmbeddings(
  queries: string[],
): Promise<number[][]> {
  const contentHash = computeQueriesHash(queries)

  if (existsSync(QUERY_EMBEDDINGS_CACHE)) {
    const cached = JSON.parse(readFileSync(QUERY_EMBEDDINGS_CACHE, 'utf-8'))
    if (cached.hash === contentHash && cached.embeddings?.length === queries.length) {
      return cached.embeddings
    }
    console.log(`  Query cache stale (hash or length mismatch), regenerating`)
  }

  console.log(`  Generating embeddings for ${queries.length} queries...`)
  const embeddings = await generateEmbeddings(queries)

  if (!existsSync(EMBEDDINGS_CACHE_DIR)) {
    mkdirSync(EMBEDDINGS_CACHE_DIR, { recursive: true })
  }
  writeFileSync(QUERY_EMBEDDINGS_CACHE, JSON.stringify({ hash: contentHash, embeddings }))
  return embeddings
}

/**
 * Creates an Orama index with embeddings and the specified text config.
 */
async function createIndexWithEmbeddings(
  chunks: ChunkShape[],
  embeddings: number[][],
  config: OramaConfig,
): Promise<AnyOrama> {
  const schema = {
    chunkId: 'string',
    documentId: 'string',
    documentName: 'string',
    text: 'string',
    searchText: 'string',
    sectionPath: 'string[]',
    headingText: 'string',
    embedding: `vector[${EMBEDDING_DIMENSIONS}]`,
    chunkIndex: 'number',
  } as const

  const components = config.stemming || config.stopWords
    ? {
        tokenizer: {
          language: 'english',
          stemming: config.stemming,
          stopWords: config.stopWords ? ENGLISH_STOP_WORDS_ARRAY : [],
        },
      }
    : undefined

  const db = await create({
    schema,
    ...(components && { components }),
  })

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!
    await insert(db, {
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      text: chunk.text,
      searchText: chunk.searchText,
      sectionPath: chunk.sectionPath,
      headingText: chunk.headingText,
      embedding: embeddings[i]!,
      chunkIndex: chunk.chunkIndex,
    })
  }

  return db
}

type HybridResult = {
  chunkId: string
  documentId: string
  documentName: string
  score: number
  searchText: string
  text: string
  headingText: string
  sectionPath: string[]
  chunkIndex: number
}

/**
 * Runs hybrid search (BM25 + vector) for a query.
 */
async function runHybridSearch(
  db: AnyOrama,
  query: string,
  embedding: number[],
  topK: number,
  threshold: number,
  weights: { text: number; vector: number } = { text: 0.5, vector: 0.5 },
): Promise<HybridResult[]> {
  const results = await search(db, {
    mode: 'hybrid',
    term: query,
    vector: { value: embedding, property: 'embedding' },
    properties: ['searchText', 'headingText'],
    limit: topK,
    includeVectors: false,
    similarity: 0.0,
    hybridWeights: weights,
    threshold,
  })

  return results.hits.map((hit) => ({
    chunkId: hit.document.chunkId as string,
    documentId: hit.document.documentId as string,
    documentName: hit.document.documentName as string,
    score: hit.score,
    searchText: hit.document.searchText as string,
    text: hit.document.text as string,
    headingText: (hit.document.headingText as string) ?? '',
    sectionPath: (hit.document.sectionPath as string[]) ?? [],
    chunkIndex: hit.document.chunkIndex as number,
  }))
}

/**
 * Runs vector-only search for a query.
 */
async function runVectorSearch(
  db: AnyOrama,
  embedding: number[],
  topK: number,
): Promise<HybridResult[]> {
  const results = await search(db, {
    mode: 'vector',
    vector: { value: embedding, property: 'embedding' },
    limit: topK,
    includeVectors: false,
    similarity: 0.0,
  })

  return results.hits.map((hit) => ({
    chunkId: hit.document.chunkId as string,
    documentId: hit.document.documentId as string,
    documentName: hit.document.documentName as string,
    score: hit.score,
    searchText: hit.document.searchText as string,
    text: hit.document.text as string,
    headingText: (hit.document.headingText as string) ?? '',
    sectionPath: (hit.document.sectionPath as string[]) ?? [],
    chunkIndex: hit.document.chunkIndex as number,
  }))
}

/**
 * Compute overlap between two strings: longest suffix of `a` that matches
 * a prefix of `b`, capped at `maxCheck` characters.
 * This is the correct algorithm from chunking-diagnostics.test.ts.
 */
function computeStringOverlap(a: string, b: string, maxCheck = 500): number {
  const limit = Math.min(a.length, b.length, maxCheck)
  for (let len = limit; len >= 1; len--) {
    if (a.endsWith(b.slice(0, len))) return len
  }
  return 0
}

/**
 * Computes graded metrics for a single case given a ranked list of chunks.
 * The chunks list is the full result set; we evaluate top-10.
 */
function gradedMetricsForCase(
  results: HybridResult[],
  _chunks: ChunkShape[],
  case_: GradedBenchmarkCase,
  k: number = 10,
): { ndcg: number; hit: number; recall: number } {
  // Map results to BenchmarkChunk shape for relevance resolution
  const rankedChunks = results.slice(0, k).map((r) => ({
    chunkId: r.chunkId,
    text: r.text,
    searchText: r.searchText,
  }))
  const rels = relevanceVector(rankedChunks, case_)
  return {
    ndcg: ndcgAtK(rels, k),
    hit: hitAtKGraded(rels, k),
    recall: recallAtKGraded(rels, k),
  }
}

/**
 * Computes total graded gain across ALL chunks in the corpus for a case.
 * Used as the denominator for corpus-level Recall@k.
 */
function computeCorpusTotalGain(
  chunks: ChunkShape[],
  case_: GradedBenchmarkCase,
): number {
  let totalGain = 0
  for (const chunk of chunks) {
    const grade = chunkRelevanceGrade(
      { chunkId: chunk.chunkId, text: chunk.text, searchText: chunk.searchText },
      case_,
    )
    totalGain += Math.pow(2, grade) - 1
  }
  return totalGain
}

/**
 * Computes gain-based Recall@k against a known corpus total gain.
 * Unlike recallAtKGraded (which uses the retrieved set as denominator),
 * this measures what fraction of ALL relevant gain in the corpus was
 * captured in the top-k retrieved results.
 */
function recallAtKVsCorpus(
  results: HybridResult[],
  case_: GradedBenchmarkCase,
  k: number,
  totalCorpusGain: number,
): number {
  if (totalCorpusGain === 0) return 0
  let topKGain = 0
  const limit = Math.min(results.length, k)
  for (let i = 0; i < limit; i++) {
    const r = results[i]!
    const grade = chunkRelevanceGrade(
      { chunkId: r.chunkId, text: r.text, searchText: r.searchText },
      case_,
    )
    topKGain += Math.pow(2, grade) - 1
  }
  return topKGain / totalCorpusGain
}

/**
 * Replicates the production search pipeline from search.service.ts faithfully:
 *   1. Retrieve RERANK_CANDIDATE_POOL (100) candidates from Orama
 *   2. Filter empty chunks
 *   3. Rerank with lexical/metadata boost
 *   4. Filter by relative threshold (DEFAULT_MIN_SCORE% of top score)
 *      AND absolute threshold (MIN_ABSOLUTE_SCORE)
 *   5. Truncate to maxResults
 *   6. Query-level lexical abstention gate
 *
 * Returns the final result list (may be empty if filters/gate eliminate everything).
 */
function applyProductionPipeline(
  query: string,
  rawCandidates: HybridResult[],
  maxResults: number = 10,
): SearchResult[] {
  // Step 2: filter empty chunks
  const nonEmpty = rawCandidates.filter(
    (r) => r.text.trim().length > 0 && r.searchText.trim().length > 0,
  )

  // Map to SearchResult shape for rerank
  const candidates: SearchResult[] = nonEmpty.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    documentName: r.documentName,
    text: r.text,
    searchText: r.searchText,
    sectionPath: r.sectionPath,
    headingText: r.headingText,
    score: r.score,
    chunkIndex: r.chunkIndex,
  }))

  if (candidates.length === 0) return []

  // Step 3: rerank
  const reranked = rankByLexicalRelevance(query, candidates)

  // Step 4: relative + absolute threshold
  const topScore = Math.max(...reranked.map((r) => r.score))
  const relativeThreshold = topScore * (DEFAULT_MIN_SCORE / 100)
  const filtered = reranked.filter(
    (r) => r.score >= relativeThreshold && r.score >= MIN_ABSOLUTE_SCORE,
  )

  // Step 5: truncate
  const truncated = filtered.slice(0, maxResults)

  // Step 6: query-level lexical abstention gate
  if (truncated.length > 0) {
    const hasQualifying = truncated.some(
      (r) => computeLexicalCoverage(query, r.searchText) >= MIN_QUERY_LEXICAL_COVERAGE,
    )
    if (!hasQualifying) return []
  }

  return truncated
}

describe.skipIf(!RUN_HYBRID_BENCHMARK)(
  'Hybrid Benchmark with Real Embeddings (v2 graded ground truth)',
  () => {
    let oldChunks: ChunkShape[]
    let newChunks: ChunkShape[]
    let oldEmbeddings: number[][]
    let newEmbeddings: number[][]
    let queryEmbeddings: number[][]
    let queries: string[]

    // 6 indexes: A, B, C, D, E, F
    let indexA: AnyOrama
    let indexB: AnyOrama
    let indexC: AnyOrama
    let indexD: AnyOrama
    let indexE: AnyOrama
    let indexF: AnyOrama

    beforeAll(async () => {
      const { content, documentId, documentName } = loadRawContent()
      console.log(`\nSource content: ${content.length} chars`)

      oldChunks = loadOldChunks()
      console.log(`Old chunks (from fixture): ${oldChunks.length}`)

      newChunks = rechunkNew(content, documentId, documentName)
      console.log(`New chunks (re-chunked): ${newChunks.length}`)

      // Generate/load embeddings
      console.log('\n--- Generating embeddings ---')
      oldEmbeddings = await getOrGenerateEmbeddings(oldChunks, OLD_EMBEDDINGS_CACHE, 'old')
      newEmbeddings = await getOrGenerateEmbeddings(newChunks, NEW_EMBEDDINGS_CACHE, 'new')

      // Query embeddings (v2 dataset: 14 positive + 6 negative = 20 queries)
      queries = [
        ...POSITIVE_CASES_V2.map((c) => c.query),
        ...NEGATIVE_CASES_V2.map((c) => c.query),
      ]
      queryEmbeddings = await getOrGenerateQueryEmbeddings(queries)
      console.log(`Total queries: ${queries.length} (${POSITIVE_CASES_V2.length} positive, ${NEGATIVE_CASES_V2.length} negative)`)

      // Create 6 indexes
      console.log('\n--- Creating Orama indexes ---')
      indexA = await createIndexWithEmbeddings(oldChunks, oldEmbeddings, OLD_ORAMA)
      indexB = await createIndexWithEmbeddings(oldChunks, oldEmbeddings, NEW_ORAMA)
      indexC = await createIndexWithEmbeddings(newChunks, newEmbeddings, OLD_ORAMA)
      indexD = await createIndexWithEmbeddings(newChunks, newEmbeddings, NEW_ORAMA)
      indexE = await createIndexWithEmbeddings(newChunks, newEmbeddings, TOKENIZER_ONLY_ORAMA)
      indexF = await createIndexWithEmbeddings(newChunks, newEmbeddings, AGGRESSIVE_THRESHOLD_ORAMA)
      console.log('Indexes created.')
    }, 300_000) // 5 min timeout for embedding generation

    it('measures nDCG@10, Hit@10, Recall@10 for all 6 conditions (hybrid search)', async () => {
      const TOP_K = 10 // nDCG@10, Hit@10, Recall@10 all at k=10
      const RETRIEVE_K = 50 // retrieve enough candidates

      const conditions = [
        { label: 'A', db: indexA, chunks: oldChunks, config: OLD_ORAMA, desc: 'old chunks + old Orama (thr=1.0)' },
        { label: 'B', db: indexB, chunks: oldChunks, config: NEW_ORAMA, desc: 'old chunks + new Orama (thr=0.5)' },
        { label: 'C', db: indexC, chunks: newChunks, config: OLD_ORAMA, desc: 'new chunks + old Orama (thr=1.0)' },
        { label: 'D', db: indexD, chunks: newChunks, config: NEW_ORAMA, desc: 'new chunks + new Orama (thr=0.5)' },
        { label: 'E', db: indexE, chunks: newChunks, config: TOKENIZER_ONLY_ORAMA, desc: 'new chunks + tokenizer only (thr=1.0)' },
        { label: 'F', db: indexF, chunks: newChunks, config: AGGRESSIVE_THRESHOLD_ORAMA, desc: 'new chunks + tokenizer (thr=0.3)' },
      ]

      type ConditionMetrics = {
        label: string
        desc: string
        ndcgAt10: number
        hitAt10: number
        recallAt10: number
        chunkCount: number
      }

      const allMetrics: ConditionMetrics[] = []

      for (const { label, db, chunks, config, desc } of conditions) {
        let ndcgSum = 0
        let hitSum = 0
        let recallSum = 0

        for (let qi = 0; qi < POSITIVE_CASES_V2.length; qi++) {
          const c = POSITIVE_CASES_V2[qi]!
          const results = await runHybridSearch(
            db,
            c.query,
            queryEmbeddings[qi]!,
            RETRIEVE_K,
            config.threshold,
          )

          const m = gradedMetricsForCase(results, chunks, c, TOP_K)
          ndcgSum += m.ndcg
          hitSum += m.hit
          recallSum += m.recall
        }

        const n = POSITIVE_CASES_V2.length
        allMetrics.push({
          label,
          desc,
          ndcgAt10: ndcgSum / n,
          hitAt10: hitSum / n,
          recallAt10: recallSum / n,
          chunkCount: chunks.length,
        })
      }

      // Print summary table
      console.log('\n' + '='.repeat(120))
      console.log('HYBRID SEARCH BENCHMARK v2 (graded ground truth, real embeddings)')
      console.log('Primary metric: nDCG@10')
      console.log('='.repeat(120))
      console.log()
      console.log(
        'Condition | Chunks | Config description                    | nDCG@10 | Hit@10 | Recall@10',
      )
      console.log(
        '----------|--------|---------------------------------------|---------|--------|----------',
      )
      for (const m of allMetrics) {
        console.log(
          `${m.label.padEnd(9)} | ${String(m.chunkCount).padEnd(6)} | ${m.desc.padEnd(37)} | ${m.ndcgAt10.toFixed(4).padEnd(7)} | ${m.hitAt10.toFixed(4).padEnd(6)} | ${m.recallAt10.toFixed(4)}`,
        )
      }

      console.log()
      console.log('KEY COMPARISONS:')
      const getMetric = (label: string) => allMetrics.find((m) => m.label === label)!
      const c = getMetric('C')
      const e = getMetric('E')
      const d = getMetric('D')
      console.log(`  C vs E (tokenizer effect, threshold=1.0): ΔnDCG@10 = ${((e.ndcgAt10 - c.ndcgAt10) * 100).toFixed(2)}%`)
      console.log(`  C vs D (chunking + tokenizer + threshold): ΔnDCG@10 = ${((d.ndcgAt10 - c.ndcgAt10) * 100).toFixed(2)}%`)
      console.log(`  E vs D (threshold 1.0 vs 0.5): ΔnDCG@10 = ${((d.ndcgAt10 - e.ndcgAt10) * 100).toFixed(2)}%`)
      console.log(`  D vs F (threshold 0.5 vs 0.3): ΔnDCG@10 = ${((getMetric('F').ndcgAt10 - d.ndcgAt10) * 100).toFixed(2)}%`)

      // Per-query detail
      console.log('\n' + '='.repeat(120))
      console.log('PER-QUERY DETAIL (nDCG@10 per case, hybrid search)')
      console.log('='.repeat(120))

      for (let qi = 0; qi < POSITIVE_CASES_V2.length; qi++) {
        const c = POSITIVE_CASES_V2[qi]!
        console.log(`\n  ${c.id}: "${c.query}"`)
        console.log(`  Fragments: ${c.fragments.map((f) => `[g${f.grade}] "${f.text.slice(0, 50)}..."`).join(' | ')}`)

        for (const { label, db, chunks, config } of conditions) {
          const results = await runHybridSearch(
            db,
            c.query,
            queryEmbeddings[qi]!,
            RETRIEVE_K,
            config.threshold,
          )
          const m = gradedMetricsForCase(results, chunks, c, TOP_K)
          console.log(
            `    ${label}: nDCG=${m.ndcg.toFixed(3)} hit=${m.hit} recall=${m.recall.toFixed(3)} candidates=${results.length}`,
          )
        }
      }
    }, 120_000)

    it('measures vector-only search A vs D (embedding truncation fix effect)', async () => {
      const TOP_K = 10
      const RETRIEVE_K = 50

      const computeVectorMetrics = async (
        db: AnyOrama,
        chunks: ChunkShape[],
      ): Promise<{ ndcgAt10: number; hitAt10: number; recallAt10: number }> => {
        let ndcgSum = 0
        let hitSum = 0
        let recallSum = 0

        for (let qi = 0; qi < POSITIVE_CASES_V2.length; qi++) {
          const c = POSITIVE_CASES_V2[qi]!
          const results = await runVectorSearch(db, queryEmbeddings[qi]!, RETRIEVE_K)
          const m = gradedMetricsForCase(results, chunks, c, TOP_K)
          ndcgSum += m.ndcg
          hitSum += m.hit
          recallSum += m.recall
        }

        const n = POSITIVE_CASES_V2.length
        return {
          ndcgAt10: ndcgSum / n,
          hitAt10: hitSum / n,
          recallAt10: recallSum / n,
        }
      }

      const metricsA = await computeVectorMetrics(indexA, oldChunks)
      const metricsD = await computeVectorMetrics(indexD, newChunks)

      console.log('\n' + '='.repeat(100))
      console.log('VECTOR-ONLY SEARCH: A (104 old chunks) vs D (166 new chunks)')
      console.log('Isolates the effect of fixing embedding truncation (32% of old chunks lost text).')
      console.log('='.repeat(100))
      console.log()
      console.log('Condition | Chunks | nDCG@10 | Hit@10 | Recall@10')
      console.log('----------|--------|---------|--------|----------')
      console.log(
        `A (old)   | ${String(oldChunks.length).padEnd(6)} | ${metricsA.ndcgAt10.toFixed(4).padEnd(7)} | ${metricsA.hitAt10.toFixed(4).padEnd(6)} | ${metricsA.recallAt10.toFixed(4)}`,
      )
      console.log(
        `D (new)   | ${String(newChunks.length).padEnd(6)} | ${metricsD.ndcgAt10.toFixed(4).padEnd(7)} | ${metricsD.hitAt10.toFixed(4).padEnd(6)} | ${metricsD.recallAt10.toFixed(4)}`,
      )
      console.log()
      console.log(`Δ nDCG@10:    ${((metricsD.ndcgAt10 - metricsA.ndcgAt10) * 100).toFixed(2)}%`)
      console.log(`Δ Hit@10:     ${((metricsD.hitAt10 - metricsA.hitAt10) * 100).toFixed(2)}%`)
      console.log(`Δ Recall@10:  ${((metricsD.recallAt10 - metricsA.recallAt10) * 100).toFixed(2)}%`)

      // Per-query vector detail
      console.log('\n  Per-query vector-only nDCG@10:')
      for (let qi = 0; qi < POSITIVE_CASES_V2.length; qi++) {
        const c = POSITIVE_CASES_V2[qi]!
        const resA = await runVectorSearch(indexA, queryEmbeddings[qi]!, RETRIEVE_K)
        const resD = await runVectorSearch(indexD, queryEmbeddings[qi]!, RETRIEVE_K)
        const mA = gradedMetricsForCase(resA, oldChunks, c, TOP_K)
        const mD = gradedMetricsForCase(resD, newChunks, c, TOP_K)
        console.log(
          `    ${c.id.padEnd(24)}: A=${mA.ndcg.toFixed(3)} D=${mD.ndcg.toFixed(3)} Δ=${((mD.ndcg - mA.ndcg) * 100).toFixed(1)}%`,
        )
      }
    }, 120_000)

    it('sweeps hybrid weights on condition D (best config) — nDCG@10, Hit@10, Recall@10, Recall@50', async () => {
      const TOP_K = 10
      const RETRIEVE_K = 50

      const weightConfigs = [
        { text: 1.0, vector: 0.0, label: '1.0/0.0 (text only)' },
        { text: 0.75, vector: 0.25, label: '0.75/0.25' },
        { text: 0.5, vector: 0.5, label: '0.5/0.5 (balanced)' },
        { text: 0.25, vector: 0.75, label: '0.25/0.75' },
        { text: 0.1, vector: 0.9, label: '0.1/0.9 (semantic)' },
        { text: 0.0, vector: 1.0, label: '0.0/1.0 (vector only)' },
      ]

      // Pre-compute corpus total gain for each positive case (for Recall@50)
      const corpusGains: number[] = []
      for (const c of POSITIVE_CASES_V2) {
        corpusGains.push(computeCorpusTotalGain(newChunks, c))
      }

      type WeightMetrics = {
        label: string
        ndcgAt10: number
        hitAt10: number
        recallAt10: number
        recallAt50: number
      }

      const allWeightMetrics: WeightMetrics[] = []

      for (const wc of weightConfigs) {
        let ndcgSum = 0
        let hitSum = 0
        let recall10Sum = 0
        let recall50Sum = 0

        for (let qi = 0; qi < POSITIVE_CASES_V2.length; qi++) {
          const c = POSITIVE_CASES_V2[qi]!
          const results = await runHybridSearch(
            indexD,
            c.query,
            queryEmbeddings[qi]!,
            RETRIEVE_K,
            NEW_ORAMA.threshold,
            { text: wc.text, vector: wc.vector },
          )

          // nDCG@10, Hit@10, Recall@10 (using retrieved set as denominator)
          const m = gradedMetricsForCase(results, newChunks, c, TOP_K)
          ndcgSum += m.ndcg
          hitSum += m.hit
          recall10Sum += m.recall

          // Recall@50 (corpus-level: gain in top-50 / total corpus gain)
          recall50Sum += recallAtKVsCorpus(results, c, 50, corpusGains[qi]!)
        }

        const n = POSITIVE_CASES_V2.length
        allWeightMetrics.push({
          label: wc.label,
          ndcgAt10: ndcgSum / n,
          hitAt10: hitSum / n,
          recallAt10: recall10Sum / n,
          recallAt50: recall50Sum / n,
        })
      }

      // Print summary table
      console.log('\n' + '='.repeat(120))
      console.log('HYBRID WEIGHT SWEEP on condition D (166 new chunks, new tokenizer, thr=0.5)')
      console.log('Primary metric: nDCG@10. Recall@50 = corpus-level gain-based recall.')
      console.log('='.repeat(120))
      console.log()
      console.log(
        'text/vector          | nDCG@10 | Hit@10 | Recall@10 | Recall@50',
      )
      console.log(
        '---------------------|---------|--------|-----------|----------',
      )
      for (const m of allWeightMetrics) {
        console.log(
          `${m.label.padEnd(22)} | ${m.ndcgAt10.toFixed(4).padEnd(7)} | ${m.hitAt10.toFixed(4).padEnd(6)} | ${m.recallAt10.toFixed(4).padEnd(9)} | ${m.recallAt50.toFixed(4)}`,
        )
      }

      // Find best by nDCG@10 and best by Recall@50
      const bestNdcg = allWeightMetrics.reduce((a, b) => a.ndcgAt10 > b.ndcgAt10 ? a : b)
      const bestRecall50 = allWeightMetrics.reduce((a, b) => a.recallAt50 > b.recallAt50 ? a : b)
      console.log()
      console.log(`Best nDCG@10:     ${bestNdcg.label} (${bestNdcg.ndcgAt10.toFixed(4)})`)
      console.log(`Best Recall@50:   ${bestRecall50.label} (${bestRecall50.recallAt50.toFixed(4)})`)

      // Per-query detail for the weight sweep
      console.log('\n' + '='.repeat(120))
      console.log('PER-QUERY DETAIL (nDCG@10 per weight config)')
      console.log('='.repeat(120))

      for (let qi = 0; qi < POSITIVE_CASES_V2.length; qi++) {
        const c = POSITIVE_CASES_V2[qi]!
        console.log(`\n  ${c.id}: "${c.query}"`)

        for (const wc of weightConfigs) {
          const results = await runHybridSearch(
            indexD,
            c.query,
            queryEmbeddings[qi]!,
            RETRIEVE_K,
            NEW_ORAMA.threshold,
            { text: wc.text, vector: wc.vector },
          )
          const m = gradedMetricsForCase(results, newChunks, c, TOP_K)
          const r50 = recallAtKVsCorpus(results, c, 50, corpusGains[qi]!)
          console.log(
            `    ${wc.label.padEnd(22)}: nDCG=${m.ndcg.toFixed(3)} hit=${m.hit} rec10=${m.recall.toFixed(3)} rec50=${r50.toFixed(3)} candidates=${results.length}`,
          )
        }
      }
    }, 120_000)

    it('measures FALSE POSITIVE RATE via production pipeline (rerank + thresholds + lexical gate)', async () => {
      const CANDIDATE_POOL = 100 // matches RERANK_CANDIDATE_POOL in production

      console.log('\n' + '='.repeat(120))
      console.log('FALSE POSITIVE RATE: production pipeline (rerank + thresholds + lexical gate)')
      console.log('Replicates search.service.ts faithfully: retrieve 100 → rerank → relative/absolute')
      console.log('thresholds → truncate to 10 → query-level lexical gate (coverage ≥ 0.5).')
      console.log('FPR = fraction of negative queries that return ≥ 1 result.')
      console.log('='.repeat(120))
      console.log()

      const conditions = [
        { label: 'A', db: indexA, config: OLD_ORAMA },
        { label: 'B', db: indexB, config: NEW_ORAMA },
        { label: 'C', db: indexC, config: OLD_ORAMA },
        { label: 'D', db: indexD, config: NEW_ORAMA },
        { label: 'E', db: indexE, config: TOKENIZER_ONLY_ORAMA },
        { label: 'F', db: indexF, config: AGGRESSIVE_THRESHOLD_ORAMA },
      ]

      console.log('Query                                | A | B | C | D | E | F | (returned results?)')
      console.log('-------------------------------------|---|---|---|---|---|---|---------------------')

      // Count how many negative queries return ≥1 result per condition
      const fprCounts = [0, 0, 0, 0, 0, 0]
      const totalNeg = NEGATIVE_CASES_V2.length

      for (let qi = 0; qi < NEGATIVE_CASES_V2.length; qi++) {
        const c = NEGATIVE_CASES_V2[qi]!
        const queryIdx = POSITIVE_CASES_V2.length + qi
        const returnedFlags: string[] = []

        for (let ci = 0; ci < conditions.length; ci++) {
          const { db, config } = conditions[ci]!

          // Step 1: retrieve candidate pool from Orama
          const rawCandidates = await runHybridSearch(
            db,
            c.query,
            queryEmbeddings[queryIdx]!,
            CANDIDATE_POOL,
            config.threshold,
          )

          // Steps 2-6: apply production pipeline
          const finalResults = applyProductionPipeline(c.query, rawCandidates, 10)
          const hasResults = finalResults.length > 0

          if (hasResults) fprCounts[ci]!++
          returnedFlags.push(hasResults ? `YES(${finalResults.length})` : 'no')
        }

        console.log(
          `${c.query.slice(0, 37).padEnd(37)} | ${returnedFlags.map((f) => f.padStart(7)).join(' | ')}`,
        )
      }

      console.log('-------------------------------------|---|---|---|---|---|---|---------------------')
      console.log(
        `${'Queries returning ≥1 result'.padEnd(37)} | ${fprCounts.map((n) => String(n).padStart(5) + '/6').join(' | ')}`,
      )
      console.log(
        `${'FPR'.padEnd(37)} | ${fprCounts.map((n) => ((n / totalNeg) * 100).toFixed(1).padStart(5) + '%').join(' | ')}`,
      )

      // Also show what the raw (no-pipeline) counts would be for comparison
      console.log()
      console.log('COMPARISON: raw Orama output (no production filters) — what the OLD test measured:')
      console.log('Query                                | A | B | C | D | E | F')
      console.log('-------------------------------------|---|---|---|---|---|---')

      const rawTotals = [0, 0, 0, 0, 0, 0]
      for (let qi = 0; qi < NEGATIVE_CASES_V2.length; qi++) {
        const c = NEGATIVE_CASES_V2[qi]!
        const queryIdx = POSITIVE_CASES_V2.length + qi
        const counts: number[] = []

        for (const { db, config } of conditions) {
          const results = await runHybridSearch(
            db,
            c.query,
            queryEmbeddings[queryIdx]!,
            10,
            config.threshold,
          )
          counts.push(results.length)
        }

        for (let i = 0; i < 6; i++) rawTotals[i]! += counts[i]!

        console.log(
          `${c.query.slice(0, 37).padEnd(37)} | ${counts.map((n) => String(n).padStart(2)).join(' | ')}`,
        )
      }
      console.log('-------------------------------------|---|---|---|---|---|---')
      console.log(
        `${'TOTAL'.padEnd(37)} | ${rawTotals.map((n) => String(n).padStart(2)).join(' | ')}`,
      )
    }, 120_000)

    it('diagnoses overlap with correct suffix-prefix algorithm', async () => {
      console.log('\n' + '='.repeat(100))
      console.log('OVERLAP DIAGNOSTICS (correct suffix-prefix algorithm)')
      console.log('='.repeat(100))

      // Measure overlap between consecutive new chunks using the correct algorithm
      let totalOverlapChars = 0
      let chunksWithOverlap = 0
      const overlaps: number[] = []

      for (let i = 1; i < newChunks.length; i++) {
        const prev = newChunks[i - 1]!.searchText
        const curr = newChunks[i]!.searchText
        const overlap = computeStringOverlap(prev, curr)
        overlaps.push(overlap)
        if (overlap > 0) {
          totalOverlapChars += overlap
          chunksWithOverlap++
        }
      }

      const totalPairs = newChunks.length - 1
      const meanOverlap = overlaps.length > 0
        ? overlaps.reduce((a, b) => a + b, 0) / overlaps.length
        : 0
      const medianOverlap = [...overlaps].sort((a, b) => a - b)[Math.floor(overlaps.length / 2)]!

      console.log(`  New chunks: ${newChunks.length}`)
      console.log(`  Consecutive pairs: ${totalPairs}`)
      console.log(`  Pairs with overlap > 0: ${chunksWithOverlap} / ${totalPairs}`)
      console.log(`  Total overlap characters: ${totalOverlapChars}`)
      console.log(`  Mean overlap: ${meanOverlap.toFixed(1)} chars`)
      console.log(`  Median overlap: ${medianOverlap} chars`)
      console.log(`  Max overlap: ${Math.max(...overlaps)} chars`)

      // Overlap as fraction of total searchText
      const totalNewSearchTextChars = newChunks.reduce((s, c) => s + c.searchText.length, 0)
      console.log(`  Total searchText chars: ${totalNewSearchTextChars}`)
      console.log(`  Overlap as fraction of total: ${((totalOverlapChars / totalNewSearchTextChars) * 100).toFixed(1)}%`)

      // Distribution
      const buckets = [0, 50, 100, 150, 200, 300, 500]
      console.log('\n  Overlap distribution:')
      for (let i = 0; i < buckets.length; i++) {
        const lo = buckets[i]!
        const hi = buckets[i + 1] ?? Infinity
        const count = overlaps.filter((o) => o >= lo && o < hi).length
        console.log(`    [${lo}, ${hi === Infinity ? '∞' : hi}): ${count}`)
      }
    }, 60_000)
  },
)
