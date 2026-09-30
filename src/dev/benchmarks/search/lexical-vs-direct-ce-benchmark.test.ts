/**
 * @vitest-environment node
 *
 * A/B benchmark: lexical reranker + cross-encoder vs. cross-encoder direct.
 *
 * Compares two production-equivalent pipelines on the same retrieval pool:
 *
 *   A) retrieval → lexical rerank → top-40 → cross-encoder → abstention
 *   B) retrieval → cross-encoder directly on top-40 → abstention
 *
 * Both pipelines use the same Orama hybrid retrieval (top-100 candidates),
 * the same cross-encoder model, and the same abstention threshold (-6.0).
 * The only difference is whether the lexical reranker pre-filters the pool
 * before the cross-encoder sees it.
 *
 * Goal: determine whether the lexical reranker adds measurable value on top
 * of the cross-encoder, so we can decide whether to remove it entirely.
 *
 * GATED: only runs when LEXICAL_VS_DIRECT_CE_BENCHMARK=1 env var is set.
 * Reuses the same embedding/cross-encoder caches as cross-encoder-benchmark.test.ts.
 */

import { describe, it, beforeAll } from 'vitest'
import { create, insert, search, type AnyOrama } from '@orama/orama'
import { resolve } from 'node:path'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import {
  POSITIVE_CASES_V2,
  NEGATIVE_CASES_V2,
} from './search-benchmark.dataset.v2'
import { relevanceVector } from './search-benchmark.relevance'
import { ndcgAtK, hitAtKGraded } from './search-benchmark.ndcg'
import { chunkMarkdown } from '@/services/ingest/chunking.service'
import { ENGLISH_STOP_WORDS_ARRAY } from '@/lib/stop-words'
import { EMBEDDING_DIMENSIONS, RERANKER_ABSTENTION_THRESHOLD } from '@/lib/constants'
import { rerank } from './rerank.service'
import type { SearchResult } from '@/types/search'

const FIXTURE_PATH = resolve(__dirname, '../../fixtures', 'britnet-corpus.json')
const EMBEDDINGS_CACHE_DIR = resolve(__dirname, '../../fixtures', '.embedding-cache')
const NEW_EMBEDDINGS_CACHE = resolve(EMBEDDINGS_CACHE_DIR, 'new-chunks-embeddings.json')
const QUERY_EMBEDDINGS_CACHE = resolve(EMBEDDINGS_CACHE_DIR, 'query-embeddings.json')
const CROSS_ENCODER_CACHE = resolve(EMBEDDINGS_CACHE_DIR, 'cross-encoder-scores.json')

const RUN_BENCHMARK = process.env.LEXICAL_VS_DIRECT_CE_BENCHMARK === '1'
const RETRIEVE_K = 100
const RERANK_K = 40
const TOP_K = 10

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
  return {
    content: doc.content as string,
    documentId: doc.meta.id as string,
    documentName: doc.meta.name as string,
  }
}

function rechunkNew(content: string, documentId: string, documentName: string): ChunkShape[] {
  const chunked = chunkMarkdown(content)
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

async function getOrGenerateEmbeddings(chunks: ChunkShape[], cachePath: string): Promise<number[][]> {
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
      tokenizer: { language: 'english', stemming: true, stopWords: ENGLISH_STOP_WORDS_ARRAY },
    },
  })
  for (let i = 0; i < chunks.length; i++) {
    await insert(db, { ...chunks[i]!, embedding: embeddings[i]! })
  }
  return db
}

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
    const neededPairs = new Set<string>()
    for (const q of queries) {
      for (const c of allChunks) {
        neededPairs.add(`${q}|||${c.chunkId}`)
      }
    }
    const cachedPairs = new Set(cached.map((c) => `${c.query}|||${c.chunkId}`))
    let allPresent = true
    for (const p of neededPairs) {
      if (!cachedPairs.has(p)) {
        allPresent = false
        break
      }
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
  const { AutoTokenizer, AutoModelForSequenceClassification } = await import('@huggingface/transformers')
  const tokenizer = await AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2')
  const model = await AutoModelForSequenceClassification.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', { dtype: 'q8' })

  const map = new Map<string, number>()
  const cacheEntries: Array<{ query: string; chunkId: string; score: number }> = []
  let scoredPairs = 0
  const totalPairs = queries.length * allChunks.length

  console.log(`  Scoring ${totalPairs} (query, chunk) pairs...`)
  for (const q of queries) {
    for (const c of allChunks) {
      const input = tokenizer(q, { text_pair: c.searchText, padding: true, truncation: true })
      const outputs = await model(input)
      const logit = (outputs.logits.data as Float32Array)[0]!
      const key = `${q}|||${c.chunkId}`
      map.set(key, logit)
      cacheEntries.push({ query: q, chunkId: c.chunkId, score: logit })
      scoredPairs++
    }
  }
  console.log(`\n  Scored ${scoredPairs} pairs`)

  if (!existsSync(EMBEDDINGS_CACHE_DIR)) mkdirSync(EMBEDDINGS_CACHE_DIR, { recursive: true })
  writeFileSync(CROSS_ENCODER_CACHE, JSON.stringify(cacheEntries))
  return map
}

/**
 * Pipeline A: retrieval → lexical rerank → top-RERANK_K → cross-encoder → abstention.
 * Returns the final result list (may be empty if abstention fires).
 */
function pipelineA(
  query: string,
  hits: HybridHit[],
  ceScores: Map<string, number>,
): SearchResult[] {
  // Map to SearchResult shape for lexical rerank
  const candidates: SearchResult[] = hits
    .filter((h) => h.text.trim().length > 0 && h.searchText.trim().length > 0)
    .map((h) => ({
      chunkId: h.chunkId,
      documentId: h.documentId,
      documentName: h.documentName,
      text: h.text,
      searchText: h.searchText,
      sectionPath: h.sectionPath,
      headingText: h.headingText,
      score: h.score,
      chunkIndex: h.chunkIndex,
    }))

  if (candidates.length === 0) return []

  // Lexical rerank
  const reranked = rerank(query, candidates)

  // Take top-RERANK_K for cross-encoder
  const ceCandidates = reranked.slice(0, RERANK_K)

  // Cross-encoder scoring
  const scored = ceCandidates.map((c) => ({
    result: c,
    ceScore: ceScores.get(`${query}|||${c.chunkId}`) ?? -100,
  }))
  scored.sort((a, b) => b.ceScore - a.ceScore)

  const final = scored.map(({ result, ceScore }) => ({
    ...result,
    rerankScore: ceScore,
  }))

  // Abstention
  const hasQualifying = final.some((r) => (r.rerankScore ?? -Infinity) >= RERANKER_ABSTENTION_THRESHOLD)
  if (!hasQualifying) return []

  return final.slice(0, TOP_K)
}

/**
 * Pipeline B: retrieval → cross-encoder directly on top-RERANK_K → abstention.
 * No lexical reranker in between.
 */
function pipelineB(
  query: string,
  hits: HybridHit[],
  ceScores: Map<string, number>,
): SearchResult[] {
  // Take top-RERANK_K directly from hybrid retrieval
  const candidates = hits
    .filter((h) => h.text.trim().length > 0 && h.searchText.trim().length > 0)
    .slice(0, RERANK_K)

  if (candidates.length === 0) return []

  // Cross-encoder scoring
  const scored = candidates.map((c) => ({
    chunkId: c.chunkId,
    documentId: c.documentId,
    documentName: c.documentName,
    text: c.text,
    searchText: c.searchText,
    sectionPath: c.sectionPath,
    headingText: c.headingText,
    score: c.score,
    chunkIndex: c.chunkIndex,
    ceScore: ceScores.get(`${query}|||${c.chunkId}`) ?? -100,
  }))
  scored.sort((a, b) => b.ceScore - a.ceScore)

  const final = scored.map((s) => ({
    chunkId: s.chunkId,
    documentId: s.documentId,
    documentName: s.documentName,
    text: s.text,
    searchText: s.searchText,
    sectionPath: s.sectionPath,
    headingText: s.headingText,
    score: s.score,
    chunkIndex: s.chunkIndex,
    rerankScore: s.ceScore,
  }))

  // Abstention
  const hasQualifying = final.some((r) => (r.rerankScore ?? -Infinity) >= RERANKER_ABSTENTION_THRESHOLD)
  if (!hasQualifying) return []

  return final.slice(0, TOP_K)
}

describe.skipIf(!RUN_BENCHMARK)('Lexical Reranker vs Direct Cross-Encoder (A/B)', () => {
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
    embeddings = await getOrGenerateEmbeddings(chunks, NEW_EMBEDDINGS_CACHE)

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
  }, 600_000)

  it('compares pipeline A (lexical+CE) vs pipeline B (CE direct) on nDCG@10, Hit@10, and FPR', async () => {
    console.log('\n' + '='.repeat(120))
    console.log('A/B BENCHMARK: Lexical Reranker + Cross-Encoder vs. Cross-Encoder Direct')
    console.log(`Retrieval: top-${RETRIEVE_K} hybrid candidates`)
    console.log(`Pipeline A: retrieval → lexical rerank → top-${RERANK_K} → cross-encoder → abstention (logit ≥ ${RERANKER_ABSTENTION_THRESHOLD})`)
    console.log(`Pipeline B: retrieval → cross-encoder directly on top-${RERANK_K} → abstention (logit ≥ ${RERANKER_ABSTENTION_THRESHOLD})`)
    console.log('='.repeat(120))

    type CaseResult = {
      id: string
      query: string
      kind: 'positive' | 'negative'
      // Pipeline A
      aNdcg: number
      aHit: number
      aResultCount: number
      aAbstained: boolean
      // Pipeline B
      bNdcg: number
      bHit: number
      bResultCount: number
      bAbstained: boolean
    }
    const results: CaseResult[] = []

    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi]!
      const isPositive = qi < POSITIVE_CASES_V2.length
      const case_ = isPositive ? POSITIVE_CASES_V2[qi]! : NEGATIVE_CASES_V2[qi - POSITIVE_CASES_V2.length]!

      // Hybrid retrieval
      const hybridResults = await search(db, {
        mode: 'hybrid',
        term: q,
        vector: { value: queryEmbeddings[qi]!, property: 'embedding' },
        properties: ['searchText', 'headingText'],
        limit: RETRIEVE_K,
        includeVectors: false,
        similarity: 0.0,
        hybridWeights: { text: 0.25, vector: 0.75 },
        threshold: 1.0,
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

      // Pipeline A
      const aResults = pipelineA(q, hits, ceScores)
      const aAbstained = aResults.length === 0
      const aTop10 = aResults.slice(0, TOP_K).map((r) => ({
        chunkId: r.chunkId,
        text: r.text,
        searchText: r.searchText,
      }))
      const aRels = relevanceVector(aTop10, case_)
      const aNdcg = ndcgAtK(aRels, TOP_K)
      const aHit = hitAtKGraded(aRels, TOP_K)

      // Pipeline B
      const bResults = pipelineB(q, hits, ceScores)
      const bAbstained = bResults.length === 0
      const bTop10 = bResults.slice(0, TOP_K).map((r) => ({
        chunkId: r.chunkId,
        text: r.text,
        searchText: r.searchText,
      }))
      const bRels = relevanceVector(bTop10, case_)
      const bNdcg = ndcgAtK(bRels, TOP_K)
      const bHit = hitAtKGraded(bRels, TOP_K)

      results.push({
        id: case_.id,
        query: q,
        kind: case_.kind,
        aNdcg,
        aHit,
        aResultCount: aResults.length,
        aAbstained,
        bNdcg,
        bHit,
        bResultCount: bResults.length,
        bAbstained,
      })
    }

    // Per-query detail
    console.log('\n' + '-'.repeat(140))
    console.log('PER-QUERY RESULTS')
    console.log('-'.repeat(140))
    console.log(
      'Case                     | Kind     | A nDCG  | A Hit | A # | A abstain | B nDCG  | B Hit | B # | B abstain | Δ nDCG',
    )
    console.log(
      '-------------------------|----------|---------|-------|-----|-----------|---------|-------|-----|-----------|--------',
    )
    for (const r of results) {
      const delta = r.bNdcg - r.aNdcg
      const deltaStr = (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) + '%'
      console.log(
        `${r.id.padEnd(25)} | ${r.kind.padEnd(8)} | ${r.aNdcg.toFixed(4).padEnd(7)} | ${String(r.aHit).padEnd(5)} | ${String(r.aResultCount).padEnd(3)} | ${String(r.aAbstained).padEnd(9)} | ${r.bNdcg.toFixed(4).padEnd(7)} | ${String(r.bHit).padEnd(5)} | ${String(r.bResultCount).padEnd(3)} | ${String(r.bAbstained).padEnd(9)} | ${deltaStr}`,
      )
    }

    // Aggregate metrics
    const positiveResults = results.filter((r) => r.kind === 'positive')
    const negativeResults = results.filter((r) => r.kind === 'negative')

    const avgANdcg = positiveResults.reduce((s, r) => s + r.aNdcg, 0) / positiveResults.length
    const avgBNdcg = positiveResults.reduce((s, r) => s + r.bNdcg, 0) / positiveResults.length
    const avgAHit = positiveResults.reduce((s, r) => s + r.aHit, 0) / positiveResults.length
    const avgBHit = positiveResults.reduce((s, r) => s + r.bHit, 0) / positiveResults.length

    // False positive rate: fraction of negative queries that return ≥1 result
    const aFpr = negativeResults.filter((r) => !r.aAbstained).length / negativeResults.length
    const bFpr = negativeResults.filter((r) => !r.bAbstained).length / negativeResults.length

    console.log('\n' + '='.repeat(120))
    console.log('AGGREGATE METRICS')
    console.log('='.repeat(120))
    console.log('Positive queries (nDCG@10, Hit@10):')
    console.log(`  Pipeline A (lexical+CE): nDCG=${avgANdcg.toFixed(4)}, Hit=${avgAHit.toFixed(4)}`)
    console.log(`  Pipeline B (CE direct):  nDCG=${avgBNdcg.toFixed(4)}, Hit=${avgBHit.toFixed(4)}`)
    console.log(`  Δ nDCG: ${((avgBNdcg - avgANdcg) * 100).toFixed(2)}%, Δ Hit: ${((avgBHit - avgAHit) * 100).toFixed(2)}%`)

    console.log('\nNegative queries (False Positive Rate):')
    console.log(`  Pipeline A (lexical+CE): FPR=${(aFpr * 100).toFixed(1)}% (${negativeResults.filter((r) => !r.aAbstained).length}/${negativeResults.length})`)
    console.log(`  Pipeline B (CE direct):  FPR=${(bFpr * 100).toFixed(1)}% (${negativeResults.filter((r) => !r.bAbstained).length}/${negativeResults.length})`)

    console.log('\n' + '='.repeat(120))
    console.log('INTERPRETATION')
    console.log('='.repeat(120))
    if (Math.abs(avgBNdcg - avgANdcg) < 0.01 && Math.abs(bFpr - aFpr) < 0.05) {
      console.log('✓ Pipelines are equivalent. The lexical reranker adds no measurable value.')
      console.log('  Recommendation: remove the lexical reranker from production (already done).')
    } else if (avgBNdcg > avgANdcg && bFpr <= aFpr) {
      console.log('✓ Pipeline B (CE direct) is strictly better: higher nDCG and lower/equal FPR.')
      console.log('  Recommendation: remove the lexical reranker from production (already done).')
    } else if (avgANdcg > avgBNdcg && aFpr <= bFpr) {
      console.log('✗ Pipeline A (lexical+CE) is better. The lexical reranker adds value.')
      console.log('  Recommendation: reconsider removing the lexical reranker.')
    } else {
      console.log('? Mixed results: trade-offs between nDCG and FPR.')
      console.log('  Recommendation: manual inspection needed.')
    }
  }, 120_000)
})
