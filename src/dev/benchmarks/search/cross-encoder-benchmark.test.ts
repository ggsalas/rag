/**
 * @vitest-environment node
 *
 * Cross-encoder reranker benchmark.
 *
 * Measures nDCG@10 and Hit@10 before and after reranking with the
 * MS-MARCO MiniLM-L-6 cross-encoder. Uses the same condition D (166 new
 * chunks, new tokenizer, threshold 0.5) and weights 0.25/0.75 as the
 * baseline in hybrid-benchmark.test.ts.
 *
 * Also prints the distribution of cross-encoder logits for positive and
 * negative queries to calibrate an abstention threshold.
 *
 * GATED: only runs when CROSS_ENCODER_BENCHMARK=1 env var is set.
 * Caches cross-encoder scores to disk to avoid recomputation.
 */

import { describe, it, beforeAll } from 'vitest'
import { create, insert, search, type AnyOrama } from '@orama/orama'
import { resolve } from 'node:path'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import {
  POSITIVE_CASES_V2,
  NEGATIVE_CASES_V2,
} from './search-benchmark.dataset.v2'
import { chunkRelevanceGrade, relevanceVector } from './search-benchmark.relevance'
import { ndcgAtK, hitAtKGraded } from './search-benchmark.ndcg'
import { chunkMarkdown } from '@/services/ingest/chunking.service'
import { normalizeMarkdown } from '@/services/ingest/markdown/normalize-markdown.service'
import { ENGLISH_STOP_WORDS_ARRAY } from '@/lib/stop-words'
import { EMBEDDING_DIMENSIONS } from '@/lib/constants'

const FIXTURE_PATH = resolve(__dirname, '../../fixtures', 'britnet-corpus.json')
const EMBEDDINGS_CACHE_DIR = resolve(__dirname, '../../fixtures', '.embedding-cache')
const NEW_EMBEDDINGS_CACHE = resolve(EMBEDDINGS_CACHE_DIR, 'new-chunks-embeddings.json')
const QUERY_EMBEDDINGS_CACHE = resolve(EMBEDDINGS_CACHE_DIR, 'query-embeddings.json')
const CROSS_ENCODER_CACHE = resolve(EMBEDDINGS_CACHE_DIR, 'cross-encoder-scores.json')

const RUN_BENCHMARK = process.env.CROSS_ENCODER_BENCHMARK === '1'
const RERANK_POOL_SIZE = 40

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

function buildEmbeddingText(chunk: { searchText: string; sectionPath: string[] }): string {
  const parts: string[] = []
  if (chunk.sectionPath.length > 0) parts.push(chunk.sectionPath.join(' > '))
  parts.push(chunk.searchText)
  return parts.join('\n')
}

function loadRawContent() {
  const raw = readFileSync(FIXTURE_PATH, 'utf-8')
  const fixture = JSON.parse(raw)
  const doc = fixture.documents[0]
  return { content: doc.content as string, documentId: doc.meta.id as string, documentName: doc.meta.name as string }
}

function rechunkNew(content: string, documentId: string, documentName: string): ChunkShape[] {
  // Production path: normalizeMarkdown → chunkMarkdown
  const normalized = normalizeMarkdown(content)
  const chunked = chunkMarkdown(normalized)
  return chunked.map((c, i) => ({
    chunkId: `new::${documentId}::${i}`,
    documentId, documentName,
    text: c.text, searchText: c.searchText,
    sectionPath: c.sectionPath, headingText: c.headingText,
    chunkIndex: i,
  }))
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const { pipeline: hfPipeline } = await import('@huggingface/transformers')
  const extractor = await hfPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' })
  const results: number[][] = []
  for (const t of texts) {
    const output = await extractor(t, { pooling: 'mean', normalize: true })
    results.push(Array.from(output.data as Float32Array))
  }
  return results
}

async function getOrGenerateEmbeddings(chunks: ChunkShape[], cachePath: string, _label: string): Promise<number[][]> {
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'))
    if (cached.length === chunks.length) return cached
  }
  const texts = chunks.map((c) => buildEmbeddingText(c))
  return generateEmbeddings(texts)
}

async function getOrGenerateQueryEmbeddings(queries: string[]): Promise<number[][]> {
  if (existsSync(QUERY_EMBEDDINGS_CACHE)) {
    const cached = JSON.parse(readFileSync(QUERY_EMBEDDINGS_CACHE, 'utf-8'))
    if (cached.length === queries.length) return cached
  }
  const { pipeline: hfPipeline } = await import('@huggingface/transformers')
  const extractor = await hfPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' })
  const embeddings: number[][] = []
  for (const q of queries) {
    const output = await extractor(q, { pooling: 'mean', normalize: true })
    embeddings.push(Array.from(output.data as Float32Array))
  }
  if (!existsSync(EMBEDDINGS_CACHE_DIR)) mkdirSync(EMBEDDINGS_CACHE_DIR, { recursive: true })
  writeFileSync(QUERY_EMBEDDINGS_CACHE, JSON.stringify(embeddings))
  return embeddings
}

async function createIndex(chunks: ChunkShape[], embeddings: number[][]): Promise<AnyOrama> {
  const db = await create({
    schema: {
      chunkId: 'string', documentId: 'string', documentName: 'string',
      text: 'string', searchText: 'string', sectionPath: 'string[]',
      headingText: 'string', embedding: `vector[${EMBEDDING_DIMENSIONS}]`, chunkIndex: 'number',
    } as const,
    components: { tokenizer: { language: 'english', stemming: true, stopWords: ENGLISH_STOP_WORDS_ARRAY } },
  })
  for (let i = 0; i < chunks.length; i++) {
    await insert(db, { ...chunks[i]!, embedding: embeddings[i]! })
  }
  return db
}

type HybridHit = {
  chunkId: string
  documentId: string
  documentName: string
  text: string
  searchText: string
  sectionPath: string[]
  headingText: string
  chunkIndex: number
  score: number
}

/**
 * Loads or generates cross-encoder scores for all (query, document) pairs.
 * Cache key: query + chunkId. Score: logit (converted from sigmoid probability).
 */
async function getOrGenerateCrossEncoderScores(
  queries: string[],
  allChunks: ChunkShape[],
): Promise<Map<string, number>> {
  if (existsSync(CROSS_ENCODER_CACHE)) {
    const cached = JSON.parse(readFileSync(CROSS_ENCODER_CACHE, 'utf-8')) as Array<{
      query: string
      chunkId: string
      score: number
    }>
    // Check if cache has all needed pairs
    const neededPairs = new Set<string>()
    for (const q of queries) {
      for (const c of allChunks) {
        neededPairs.add(`${q}|||${c.chunkId}`)
      }
    }
    const cachedPairs = new Set(cached.map((c) => `${c.query}|||${c.chunkId}`))
    let allPresent = true
    for (const p of neededPairs) {
      if (!cachedPairs.has(p)) { allPresent = false; break }
    }
    if (allPresent) {
      const map = new Map<string, number>()
      for (const c of cached) {
        map.set(`${c.query}|||${c.chunkId}`, c.score)
      }
      return map
    }
  }

  console.log('  Loading cross-encoder model (Xenova/ms-marco-MiniLM-L-6-v2, q8)...')
  const startTime = Date.now()
  const { AutoTokenizer, AutoModelForSequenceClassification } = await import('@huggingface/transformers')
  const tokenizer = await AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', {
    progress_callback: (report: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (report.status === 'progress' && report.file && report.total) {
        const pct = ((report.loaded ?? 0) / report.total * 100).toFixed(1)
        process.stdout.write(`\r  Downloading ${report.file}: ${pct}%`)
      }
    },
  })
  const model = await AutoModelForSequenceClassification.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', {
    dtype: 'q8',
    progress_callback: (report: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (report.status === 'progress' && report.file && report.total) {
        const pct = ((report.loaded ?? 0) / report.total * 100).toFixed(1)
        process.stdout.write(`\r  Downloading ${report.file}: ${pct}%`)
      }
    },
  })
  const loadTime = Date.now() - startTime
  console.log(`\n  Model loaded in ${(loadTime / 1000).toFixed(1)}s`)

  const map = new Map<string, number>()
  const cacheEntries: Array<{ query: string; chunkId: string; score: number }> = []
  let totalPairs = 0
  let scoredPairs = 0

  totalPairs = queries.length * allChunks.length

  console.log(`  Scoring ${totalPairs} (query, chunk) pairs...`)
  const scoreStartTime = Date.now()

  for (const q of queries) {
    // Score in batches of 16 to balance throughput and memory
    const BATCH = 16
    for (let i = 0; i < allChunks.length; i += BATCH) {
      const batch = allChunks.slice(i, i + BATCH)
      // Tokenize each pair and run model
      for (const c of batch) {
        const input = tokenizer(q, {
          text_pair: c.searchText,
          padding: true,
          truncation: true,
        })
        const outputs = await model(input)
        const logit = (outputs.logits.data as Float32Array)[0]!
        const key = `${q}|||${c.chunkId}`
        map.set(key, logit)
        cacheEntries.push({ query: q, chunkId: c.chunkId, score: logit })
        scoredPairs++
      }
    }
    if (scoredPairs % 166 === 0 || scoredPairs === totalPairs) {
      const elapsed = Date.now() - scoreStartTime
      const rate = scoredPairs / (elapsed / 1000)
      process.stdout.write(`\r  Scored ${scoredPairs}/${totalPairs} pairs (${rate.toFixed(0)} pairs/s)`)
    }
  }
  console.log(`\n  Scoring complete in ${((Date.now() - scoreStartTime) / 1000).toFixed(1)}s`)

  if (!existsSync(EMBEDDINGS_CACHE_DIR)) mkdirSync(EMBEDDINGS_CACHE_DIR, { recursive: true })
  writeFileSync(CROSS_ENCODER_CACHE, JSON.stringify(cacheEntries))
  console.log(`  Cached ${cacheEntries.length} cross-encoder scores to ${CROSS_ENCODER_CACHE}`)

  return map
}

describe.skipIf(!RUN_BENCHMARK)('Cross-Encoder Reranker Benchmark', () => {
  let chunks: ChunkShape[]
  let embeddings: number[][]
  let queryEmbeddings: number[][]
  let queries: string[]
  let db: AnyOrama
  let ceScores: Map<string, number>

  beforeAll(async () => {
    const { content, documentId, documentName } = loadRawContent()
    console.log(`\nSource content: ${content.length} chars`)
    chunks = rechunkNew(content, documentId, documentName)
    console.log(`Chunks: ${chunks.length}`)

    console.log('\n--- Loading embeddings ---')
    embeddings = await getOrGenerateEmbeddings(chunks, NEW_EMBEDDINGS_CACHE, 'new')

    queries = [
      ...POSITIVE_CASES_V2.map((c) => c.query),
      ...NEGATIVE_CASES_V2.map((c) => c.query),
    ]
    queryEmbeddings = await getOrGenerateQueryEmbeddings(queries)
    console.log(`Queries: ${queries.length} (${POSITIVE_CASES_V2.length} positive, ${NEGATIVE_CASES_V2.length} negative)`)

    console.log('\n--- Creating Orama index ---')
    db = await createIndex(chunks, embeddings)
    console.log('Index created.')

    console.log('\n--- Loading cross-encoder scores ---')
    ceScores = await getOrGenerateCrossEncoderScores(queries, chunks)
    console.log(`Cross-encoder scores loaded: ${ceScores.size} pairs`)
  }, 600_000) // 10 min timeout

  it('measures nDCG@10 and Hit@10 before and after cross-encoder reranking', async () => {
    const TOP_K = 10
    const RETRIEVE_K = 50
    const RERANK_K = RERANK_POOL_SIZE

    console.log('\n' + '='.repeat(120))
    console.log('CROSS-ENCODER RERANKER BENCHMARK')
    console.log('Condition D (166 chunks, new tokenizer, thr=0.5), weights 0.25/0.75')
    console.log(`Rerank pool: top-${RERANK_K} candidates from hybrid retrieval`)
    console.log('='.repeat(120))

    // Baseline: hybrid retrieval without cross-encoder
    type CaseResult = {
      id: string
      query: string
      kind: 'positive' | 'negative'
      baselineNdcg: number
      baselineHit: number
      rerankedNdcg: number
      rerankedHit: number
      baselineTopRank: number  // rank of best relevant chunk (1-indexed, 0 if none)
      rerankedTopRank: number
      maxLogit: number
    }
    const results: CaseResult[] = []

    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi]!
      const isPositive = qi < POSITIVE_CASES_V2.length
      const case_ = isPositive ? POSITIVE_CASES_V2[qi]! : NEGATIVE_CASES_V2[qi - POSITIVE_CASES_V2.length]!

      // Step 1: Hybrid retrieval
      const hybridResults = await search(db, {
        mode: 'hybrid',
        term: q,
        vector: { value: queryEmbeddings[qi]!, property: 'embedding' },
        properties: ['searchText', 'headingText'],
        limit: RETRIEVE_K,
        includeVectors: false,
        similarity: 0.0,
        hybridWeights: { text: 0.25, vector: 0.75 },
        threshold: 0.5,
      })

      const hits: HybridHit[] = hybridResults.hits.map((hit) => ({
        chunkId: hit.document.chunkId as string,
        documentId: hit.document.documentId as string,
        documentName: hit.document.documentName as string,
        text: hit.document.text as string,
        searchText: hit.document.searchText as string,
        sectionPath: (hit.document.sectionPath as string[]) ?? [],
        headingText: (hit.document.headingText as string) ?? '',
        chunkIndex: hit.document.chunkIndex as number,
        score: hit.score,
      }))

      // Baseline metrics (top-10 of hybrid retrieval)
      const baselineTop10 = hits.slice(0, TOP_K).map((h) => ({
        chunkId: h.chunkId, text: h.text, searchText: h.searchText,
      }))
      const baselineRels = relevanceVector(baselineTop10, case_)
      const baselineNdcg = ndcgAtK(baselineRels, TOP_K)
      const baselineHit = hitAtKGraded(baselineRels, TOP_K)

      // Find baseline top rank of relevant chunk
      let baselineTopRank = 0
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i]!
        const grade = chunkRelevanceGrade({ chunkId: h.chunkId, text: h.text, searchText: h.searchText }, case_)
        if (grade > 0) { baselineTopRank = i + 1; break }
      }

      // Step 2: Cross-encoder reranking on top-RERANK_K candidates
      const candidates = hits.slice(0, RERANK_K)
      const scored = candidates.map((c) => {
        const key = `${q}|||${c.chunkId}`
        const logit = ceScores.get(key) ?? -100
        return { ...c, ceScore: logit }
      })
      scored.sort((a, b) => b.ceScore - a.ceScore)

      // Reranked metrics (top-10 of reranked list)
      const rerankedTop10 = scored.slice(0, TOP_K).map((h) => ({
        chunkId: h.chunkId, text: h.text, searchText: h.searchText,
      }))
      const rerankedRels = relevanceVector(rerankedTop10, case_)
      const rerankedNdcg = ndcgAtK(rerankedRels, TOP_K)
      const rerankedHit = hitAtKGraded(rerankedRels, TOP_K)

      // Find reranked top rank of relevant chunk
      let rerankedTopRank = 0
      for (let i = 0; i < scored.length; i++) {
        const h = scored[i]!
        const grade = chunkRelevanceGrade({ chunkId: h.chunkId, text: h.text, searchText: h.searchText }, case_)
        if (grade > 0) { rerankedTopRank = i + 1; break }
      }

      // Max logit across all candidates
      const maxLogit = scored.length > 0 ? Math.max(...scored.map((s) => s.ceScore)) : -100

      results.push({
        id: case_.id,
        query: q,
        kind: case_.kind,
        baselineNdcg,
        baselineHit,
        rerankedNdcg,
        rerankedHit,
        baselineTopRank,
        rerankedTopRank,
        maxLogit,
      })
    }

    // Print per-query detail
    console.log('\n' + '-'.repeat(120))
    console.log('PER-QUERY RESULTS')
    console.log('-'.repeat(120))
    console.log(
      'Case                     | Kind     | Base nDCG | Base Hit | Base Rank | CE nDCG | CE Hit | CE Rank | Δ nDCG  | Max Logit',
    )
    console.log(
      '-------------------------|----------|-----------|----------|-----------|---------|--------|---------|---------|----------',
    )
    for (const r of results) {
      const delta = r.rerankedNdcg - r.baselineNdcg
      const deltaStr = (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) + '%'
      console.log(
        `${r.id.padEnd(25)} | ${r.kind.padEnd(8)} | ${r.baselineNdcg.toFixed(4).padEnd(9)} | ${String(r.baselineHit).padEnd(8)} | ${String(r.baselineTopRank).padEnd(9)} | ${r.rerankedNdcg.toFixed(4).padEnd(7)} | ${String(r.rerankedHit).padEnd(6)} | ${String(r.rerankedTopRank).padEnd(7)} | ${deltaStr.padEnd(7)} | ${r.maxLogit.toFixed(2)}`,
      )
    }

    // Aggregate metrics
    const positiveResults = results.filter((r) => r.kind === 'positive')
    const negativeResults = results.filter((r) => r.kind === 'negative')

    const avgBaselineNdcg = positiveResults.reduce((s, r) => s + r.baselineNdcg, 0) / positiveResults.length
    const avgRerankedNdcg = positiveResults.reduce((s, r) => s + r.rerankedNdcg, 0) / positiveResults.length
    const avgBaselineHit = positiveResults.reduce((s, r) => s + r.baselineHit, 0) / positiveResults.length
    const avgRerankedHit = positiveResults.reduce((s, r) => s + r.rerankedHit, 0) / positiveResults.length

    console.log('\n' + '='.repeat(120))
    console.log('AGGREGATE METRICS (positive queries only)')
    console.log('='.repeat(120))
    console.log(`  nDCG@10:  baseline = ${avgBaselineNdcg.toFixed(4)},  cross-encoder = ${avgRerankedNdcg.toFixed(4)},  Δ = ${((avgRerankedNdcg - avgBaselineNdcg) * 100).toFixed(2)}%`)
    console.log(`  Hit@10:   baseline = ${avgBaselineHit.toFixed(4)},  cross-encoder = ${avgRerankedHit.toFixed(4)},  Δ = ${((avgRerankedHit - avgBaselineHit) * 100).toFixed(2)}%`)

    // Logit distribution
    console.log('\n' + '='.repeat(120))
    console.log('LOGIT DISTRIBUTION (max logit per query)')
    console.log('='.repeat(120))

    const positiveLogits = positiveResults.map((r) => r.maxLogit).sort((a, b) => a - b)
    const negativeLogits = negativeResults.map((r) => r.maxLogit).sort((a, b) => a - b)

    console.log('\n  Positive queries (14):')
    console.log(`    min = ${positiveLogits[0]!.toFixed(2)}, max = ${positiveLogits[positiveLogits.length - 1]!.toFixed(2)}, median = ${positiveLogits[Math.floor(positiveLogits.length / 2)]!.toFixed(2)}`)
    console.log(`    values: ${positiveLogits.map((l) => l.toFixed(2)).join(', ')}`)

    console.log('\n  Negative queries (6):')
    console.log(`    min = ${negativeLogits[0]!.toFixed(2)}, max = ${negativeLogits[negativeLogits.length - 1]!.toFixed(2)}, median = ${negativeLogits[Math.floor(negativeLogits.length / 2)]!.toFixed(2)}`)
    console.log(`    values: ${negativeLogits.map((l) => l.toFixed(2)).join(', ')}`)

    // Check separation
    const minPositive = positiveLogits[0]!
    const maxNegative = negativeLogits[negativeLogits.length - 1]!
    if (minPositive > maxNegative) {
      console.log(`\n  ✓ PERFECT SEPARATION: min positive (${minPositive.toFixed(2)}) > max negative (${maxNegative.toFixed(2)})`)
      console.log(`    Proposed threshold: ${((minPositive + maxNegative) / 2).toFixed(2)}`)
    } else {
      console.log(`\n  ✗ OVERLAP: min positive (${minPositive.toFixed(2)}) ≤ max negative (${maxNegative.toFixed(2)})`)
      console.log(`    Cannot find a threshold that perfectly separates positives from negatives.`)
      // Find best threshold by sweeping
      const allLogits = [...positiveLogits, ...negativeLogits].sort((a, b) => a - b)
      let bestThreshold = 0
      let bestAccuracy = 0
      for (const t of allLogits) {
        const tp = positiveLogits.filter((l) => l >= t).length
        const tn = negativeLogits.filter((l) => l < t).length
        const acc = (tp + tn) / (positiveLogits.length + negativeLogits.length)
        if (acc > bestAccuracy) {
          bestAccuracy = acc
          bestThreshold = t
        }
      }
      console.log(`    Best threshold by accuracy: ${bestThreshold.toFixed(2)} (accuracy = ${(bestAccuracy * 100).toFixed(1)}%)`)
    }

    // FPR with proposed threshold
    console.log('\n' + '='.repeat(120))
    console.log('ABSTENTION ANALYSIS')
    console.log('='.repeat(120))

    // Try a few thresholds
    const thresholds = [0, 2, 4, 5, 6, 7, 8, 10]
    console.log('\n  Threshold | Positives retained | Negatives filtered | FPR')
    console.log('  ----------|--------------------|--------------------|-----')
    for (const t of thresholds) {
      const posRetained = positiveResults.filter((r) => r.maxLogit >= t).length
      const negFiltered = negativeResults.filter((r) => r.maxLogit < t).length
      const fpr = negativeResults.filter((r) => r.maxLogit >= t).length / negativeResults.length
      console.log(`  ${String(t).padEnd(9)} | ${String(posRetained).padEnd(18)} | ${String(negFiltered).padEnd(18)} | ${(fpr * 100).toFixed(1)}%`)
    }
  }, 120_000)
})
