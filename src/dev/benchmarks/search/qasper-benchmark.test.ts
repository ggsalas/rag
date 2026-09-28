/**
 * @vitest-environment node
 *
 * QASPER multi-document benchmark.
 *
 * Tests retrieval quality on two academic papers loaded into a single library,
 * measuring nDCG@5, nDCG@10, Hit@5, Hit@10, Recall@10 with the full pipeline:
 * chunkMarkdown → hybrid search (0.25/0.75 weights) → cross-encoder reranking.
 *
 * Reports logit distributions by query type (positive, unanswerable) to validate
 * the RERANKER_ABSTENTION_THRESHOLD = -6.0 calibration.
 *
 * GATED: only runs when QASPER_BENCHMARK=1 env var is set.
 * Caches embeddings and cross-encoder scores to disk.
 */

import { describe, it, beforeAll } from 'vitest'
import { create, insert, search, type AnyOrama } from '@orama/orama'
import { resolve } from 'node:path'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import {
  QASPER_POSITIVE_CASES,
  QASPER_UNANSWERABLE_CASES,
  QASPER_CROSS_NEGATIVE_CASES,
} from './search-benchmark.dataset.qasper'
import { relevanceVector } from './search-benchmark.relevance'
import { ndcgAtK, hitAtKGraded, recallAtKGraded } from './search-benchmark.ndcg'
import { chunkMarkdown, chunkText } from '@/services/ingest/chunking.service'
import { ENGLISH_STOP_WORDS_ARRAY } from '@/lib/stop-words'
import { EMBEDDING_DIMENSIONS } from '@/lib/constants'
import type { PretrainedTokenizerOptions } from '@huggingface/transformers'

const FIXTURE_DIR = resolve(__dirname, '../../fixtures')
const CACHE_DIR = resolve(__dirname, '../../fixtures', '.qasper-cache')
const EMBEDDINGS_CACHE = resolve(CACHE_DIR, 'qasper-embeddings.json')
const QUERY_EMBEDDINGS_CACHE = resolve(CACHE_DIR, 'qasper-query-embeddings.json')
const CROSS_ENCODER_CACHE = resolve(CACHE_DIR, 'qasper-cross-encoder-scores.json')

const RUN_BENCHMARK = process.env.QASPER_BENCHMARK === '1'

// `dtype` is a valid runtime option in @huggingface/transformers but it is missing
// from the library's PretrainedTokenizerOptions type. Do NOT remove it: without it
// the tokenizer downloads fp32 weights (~90 MB) instead of the quantized q8 (~23 MB).
const CROSS_ENCODER_TOKENIZER_OPTIONS = { dtype: 'q8' } as PretrainedTokenizerOptions

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

function loadMarkdownFixtures(): Array<{ content: string; documentId: string; documentName: string }> {
  const md1 = readFileSync(resolve(FIXTURE_DIR, 'qasper-1910_11471.md'), 'utf-8')
  const md2 = readFileSync(resolve(FIXTURE_DIR, 'qasper-1908_06606.md'), 'utf-8')
  return [
    { content: md1, documentId: '1910.11471', documentName: 'qasper-1910_11471.md' },
    { content: md2, documentId: '1908.06606', documentName: 'qasper-1908_06606.md' },
  ]
}

function chunkDocument(content: string, documentId: string, documentName: string): ChunkShape[] {
  const chunked = chunkMarkdown(content)
  return chunked.map((c, i) => ({
    chunkId: `${documentId}::${i}`,
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
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' })
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
  const embeddings = await generateEmbeddings(queries)
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
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
      tokenizer: {
        language: 'english',
        stemming: true,
        stopWords: ENGLISH_STOP_WORDS_ARRAY,
      },
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
  let totalPairs = queries.length * allChunks.length
  let scoredPairs = 0

  console.log(`  Scoring ${totalPairs} (query, chunk) pairs...`)
  const scoreStartTime = Date.now()

  for (const q of queries) {
    const BATCH = 16
    for (let i = 0; i < allChunks.length; i += BATCH) {
      const batch = allChunks.slice(i, i + BATCH)
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
    if (scoredPairs % 50 === 0 || scoredPairs === totalPairs) {
      const elapsed = Date.now() - scoreStartTime
      const rate = scoredPairs / (elapsed / 1000)
      process.stdout.write(`\r  Scored ${scoredPairs}/${totalPairs} pairs (${rate.toFixed(0)} pairs/s)`)
    }
  }
  console.log(`\n  Scoring complete in ${((Date.now() - scoreStartTime) / 1000).toFixed(1)}s`)

  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(CROSS_ENCODER_CACHE, JSON.stringify(cacheEntries))
  console.log(`  Cached ${cacheEntries.length} cross-encoder scores to ${CROSS_ENCODER_CACHE}`)

  return map
}

describe.skipIf(!RUN_BENCHMARK)('QASPER Multi-Document Benchmark', () => {
  let chunks: ChunkShape[]
  let embeddings: number[][]
  let queryEmbeddings: number[][]
  let queries: string[]
  let db: AnyOrama
  let ceScores: Map<string, number>
  let mainResults: Array<{
    id: string
    query: string
    kind: 'positive' | 'negative'
    ndcg5: number
    ndcg10: number
    hit5: number
    hit10: number
    recall10: number
    maxLogit: number
  }> = []

  beforeAll(async () => {
    const docs = loadMarkdownFixtures()
    console.log('\n' + '='.repeat(120))
    console.log('QASPER MULTI-DOCUMENT BENCHMARK')
    console.log('='.repeat(120))

    chunks = []
    for (const doc of docs) {
      console.log(`\n${doc.documentName}: ${doc.content.length} chars`)
      const docChunks = chunkDocument(doc.content, doc.documentId, doc.documentName)
      console.log(`  Chunks: ${docChunks.length}`)
      chunks.push(...docChunks)
    }
    console.log(`\nTotal chunks: ${chunks.length}`)

    console.log('\n--- Loading embeddings ---')
    embeddings = await getOrGenerateEmbeddings(chunks, EMBEDDINGS_CACHE)

    queries = [
      ...QASPER_POSITIVE_CASES.map((c) => c.query),
      ...QASPER_UNANSWERABLE_CASES.map((c) => c.query),
    ]
    queryEmbeddings = await getOrGenerateQueryEmbeddings(queries)
    console.log(`Queries: ${queries.length} (${QASPER_POSITIVE_CASES.length} positive, ${QASPER_UNANSWERABLE_CASES.length} unanswerable)`)

    console.log('\n--- Creating Orama index ---')
    db = await createIndex(chunks, embeddings)
    console.log('Index created.')

    console.log('\n--- Loading cross-encoder scores ---')
    ceScores = await getOrGenerateCrossEncoderScores(queries, chunks)
    console.log(`Cross-encoder scores loaded: ${ceScores.size} pairs`)
  }, 600_000)

  it('measures nDCG@5, nDCG@10, Hit@5, Hit@10, Recall@10 with cross-encoder reranking', async () => {
    const RETRIEVE_K = 50
    const RERANK_K = 40

    console.log('\n' + '='.repeat(120))
    console.log('PER-QUERY RESULTS')
    console.log('='.repeat(120))
    console.log(
      'Case                     | Kind       | nDCG@5 | nDCG@10 | Hit@5 | Hit@10 | Recall@10 | Max Logit',
    )
    console.log(
      '-------------------------|------------|--------|---------|-------|--------|-----------|----------',
    )


    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi]!
      const isPositive = qi < QASPER_POSITIVE_CASES.length
      const case_ = isPositive
        ? QASPER_POSITIVE_CASES[qi]!
        : QASPER_UNANSWERABLE_CASES[qi - QASPER_POSITIVE_CASES.length]!

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
        threshold: 0.5,
      })

      const hits = hybridResults.hits.map((hit) => ({
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

      // Cross-encoder reranking
      const candidates = hits.slice(0, RERANK_K)
      const scored = candidates.map((c) => {
        const key = `${q}|||${c.chunkId}`
        const logit = ceScores.get(key) ?? -100
        return { ...c, ceScore: logit }
      })
      scored.sort((a, b) => b.ceScore - a.ceScore)

      // Metrics at k=5 and k=10
      const top5 = scored.slice(0, 5).map((h) => ({
        chunkId: h.chunkId,
        text: h.text,
        searchText: h.searchText,
      }))
      const top10 = scored.slice(0, 10).map((h) => ({
        chunkId: h.chunkId,
        text: h.text,
        searchText: h.searchText,
      }))

      const rels5 = relevanceVector(top5, case_)
      const rels10 = relevanceVector(top10, case_)

      const ndcg5 = ndcgAtK(rels5, 5)
      const ndcg10 = ndcgAtK(rels10, 10)
      const hit5 = hitAtKGraded(rels5, 5)
      const hit10 = hitAtKGraded(rels10, 10)
      const recall10 = recallAtKGraded(rels10, 10)

      const maxLogit = scored.length > 0 ? Math.max(...scored.map((s) => s.ceScore)) : -100

      mainResults.push({
        id: case_.id,
        query: q,
        kind: case_.kind,
        ndcg5,
        ndcg10,
        hit5,
        hit10,
        recall10,
        maxLogit,
      })

      console.log(
        `${case_.id.padEnd(25)} | ${case_.kind.padEnd(10)} | ${ndcg5.toFixed(4).padEnd(6)} | ${ndcg10.toFixed(4).padEnd(7)} | ${String(hit5).padEnd(5)} | ${String(hit10).padEnd(6)} | ${recall10.toFixed(4).padEnd(9)} | ${maxLogit.toFixed(2)}`,
      )
    }

    // Aggregate metrics
    const positiveResults = mainResults.filter((r) => r.kind === 'positive')
    const negativeResults = mainResults.filter((r) => r.kind === 'negative')

    const avgNdcg5 = positiveResults.reduce((s, r) => s + r.ndcg5, 0) / positiveResults.length
    const avgNdcg10 = positiveResults.reduce((s, r) => s + r.ndcg10, 0) / positiveResults.length
    const avgHit5 = positiveResults.reduce((s, r) => s + r.hit5, 0) / positiveResults.length
    const avgHit10 = positiveResults.reduce((s, r) => s + r.hit10, 0) / positiveResults.length
    const avgRecall10 = positiveResults.reduce((s, r) => s + r.recall10, 0) / positiveResults.length

    console.log('\n' + '='.repeat(120))
    console.log('AGGREGATE METRICS (positive queries only)')
    console.log('='.repeat(120))
    console.log(`  nDCG@5:    ${avgNdcg5.toFixed(4)}`)
    console.log(`  nDCG@10:   ${avgNdcg10.toFixed(4)}`)
    console.log(`  Hit@5:     ${avgHit5.toFixed(4)}`)
    console.log(`  Hit@10:    ${avgHit10.toFixed(4)}`)
    console.log(`  Recall@10: ${avgRecall10.toFixed(4)}`)

    console.log('\n' + '='.repeat(120))
    console.log('COMPARISON WITH BRITNEY CORPUS')
    console.log('='.repeat(120))
    console.log('  Britney:  nDCG@10 = 0.6666,  Hit@10 = 0.929')
    console.log(`  QASPER:   nDCG@10 = ${avgNdcg10.toFixed(4)},  Hit@10 = ${avgHit10.toFixed(4)}`)

    // Logit distribution
    console.log('\n' + '='.repeat(120))
    console.log('LOGIT DISTRIBUTION (max logit per query)')
    console.log('='.repeat(120))

    const positiveLogits = positiveResults.map((r) => r.maxLogit).sort((a, b) => a - b)
    const negativeLogits = negativeResults.map((r) => r.maxLogit).sort((a, b) => a - b)

    console.log('\n  Positive queries (16):')
    console.log(`    min = ${positiveLogits[0]!.toFixed(2)}, max = ${positiveLogits[positiveLogits.length - 1]!.toFixed(2)}, median = ${positiveLogits[Math.floor(positiveLogits.length / 2)]!.toFixed(2)}`)
    console.log(`    values: ${positiveLogits.map((l) => l.toFixed(2)).join(', ')}`)

    console.log('\n  Unanswerable queries (3):')
    console.log(`    min = ${negativeLogits[0]!.toFixed(2)}, max = ${negativeLogits[negativeLogits.length - 1]!.toFixed(2)}, median = ${negativeLogits[Math.floor(negativeLogits.length / 2)]!.toFixed(2)}`)
    console.log(`    values: ${negativeLogits.map((l) => l.toFixed(2)).join(', ')}`)

    // Separation analysis
    const minPositive = positiveLogits[0]!
    const maxNegative = negativeLogits[negativeLogits.length - 1]!
    const gap = minPositive - maxNegative

    console.log('\n' + '='.repeat(120))
    console.log('ABSTENTION THRESHOLD ANALYSIS')
    console.log('='.repeat(120))
    console.log(`  Min positive logit:   ${minPositive.toFixed(2)}`)
    console.log(`  Max negative logit:   ${maxNegative.toFixed(2)}`)
    console.log(`  Gap:                  ${gap.toFixed(2)}`)

    if (gap > 0) {
      console.log(`\n  ✓ PERFECT SEPARATION: min positive > max negative`)
      console.log(`    Proposed threshold: ${((minPositive + maxNegative) / 2).toFixed(2)}`)
      console.log(`    Current threshold (-6.0): ${minPositive > -6.0 ? 'SAFE' : 'UNSAFE'}`)
    } else {
      console.log(`\n  ✗ OVERLAP: min positive ≤ max negative`)
      console.log(`    Current threshold (-6.0) will misclassify ${negativeLogits.filter(l => l >= -6.0).length} unanswerable as positive`)
      console.log(`    Best threshold by accuracy:`)
      
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
      console.log(`      threshold = ${bestThreshold.toFixed(2)}, accuracy = ${(bestAccuracy * 100).toFixed(1)}%`)
    }

    // Threshold sweep
    console.log('\n  Threshold sweep:')
    console.log('  Threshold | Positives retained | Unanswerable filtered | FPR')
    console.log('  ----------|--------------------|-----------------------|-----')
    const thresholds = [-5, -3, -1, 0, 1, 2, 3, 5]
    for (const t of thresholds) {
      const posRetained = positiveResults.filter((r) => r.maxLogit >= t).length
      const negFiltered = negativeResults.filter((r) => r.maxLogit < t).length
      const fpr = negativeResults.filter((r) => r.maxLogit >= t).length / negativeResults.length
      const marker = t === 0 ? ' ← current' : ''
      console.log(`  ${String(t).padEnd(9)} | ${String(posRetained).padEnd(18)} | ${String(negFiltered).padEnd(21)} | ${(fpr * 100).toFixed(1)}%${marker}`)
    }

    // Diagnostic: failing positive cases
    const failingCases = positiveResults.filter((r) => r.ndcg10 === 0)
    if (failingCases.length > 0) {
      console.log('\n' + '='.repeat(120))
      console.log('DIAGNOSTIC: FAILING POSITIVE CASES (nDCG@10 = 0)')
      console.log('='.repeat(120))
      
      for (const fc of failingCases) {
        const case_ = QASPER_POSITIVE_CASES.find((c) => c.id === fc.id)!
        console.log(`\n  ${fc.id}: "${fc.query}"`)
        console.log(`    Max logit: ${fc.maxLogit.toFixed(2)}`)
        console.log(`    Fragments: ${case_.fragments.length}`)
        
        for (let fi = 0; fi < case_.fragments.length; fi++) {
          const frag = case_.fragments[fi]!
          console.log(`    Fragment ${fi}: ${frag.text.length} chars`)
          console.log(`      "${frag.text.slice(0, 100)}..."`)
          
          // Check which chunks contain this fragment
          const normalizedFrag = frag.text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
          const containingChunks = chunks.filter((c) => {
            const normalizedText = c.searchText.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
            return normalizedText.includes(normalizedFrag)
          })
          
          console.log(`      Found in ${containingChunks.length} chunk(s):`)
          for (const cc of containingChunks) {
            const key = `${fc.query}|||${cc.chunkId}`
            const logit = ceScores.get(key) ?? -100
            console.log(`        ${cc.chunkId}: ${cc.searchText.length} chars, logit=${logit.toFixed(2)}`)
          }
          
          if (containingChunks.length === 0) {
            console.log(`      ✗ Fragment NOT found in any chunk (fragment longer than chunk?)`)
          }
        }
      }
    }
  }, 120_000)

  it('evaluates cross-negative queries against single-paper indexes', async () => {
    console.log('\n' + '='.repeat(120))
    console.log('CROSS-NEGATIVE EVALUATION')
    console.log('='.repeat(120))
    console.log('Testing whether -6.0 threshold holds when questions from paper A are evaluated against paper B only')
    console.log('')

    // Separate chunks by paper
    const paperAChunks = chunks.filter((c) => c.documentId === '1910.11471')
    const paperBChunks = chunks.filter((c) => c.documentId === '1908.06606')

    console.log(`Paper A (1910.11471): ${paperAChunks.length} chunks`)
    console.log(`Paper B (1908.06606): ${paperBChunks.length} chunks`)
    console.log(`Cross-negative cases: ${QASPER_CROSS_NEGATIVE_CASES.length}`)
    console.log('')

    // Load cross-encoder model
    console.log('Loading cross-encoder model...')
    const { AutoTokenizer, AutoModelForSequenceClassification } = await import('@huggingface/transformers')
    const tokenizer = await AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', CROSS_ENCODER_TOKENIZER_OPTIONS)
    const model = await AutoModelForSequenceClassification.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', { dtype: 'q8' })
    console.log('Model loaded.')
    console.log('')

    // Score each cross-negative query against the opposite paper's chunks
    const crossNegativeLogits: number[] = []
    const crossNegativeDetails: Array<{ id: string; query: string; sourcePaper: string; targetPaper: string; maxLogit: number }> = []

    for (const case_ of QASPER_CROSS_NEGATIVE_CASES) {
      // Parse ID to determine source paper: "cross-1910.11471-q0" or "cross-1908.06606-q0"
      const match = case_.id.match(/^cross-(\d+\.\d+)-q\d+$/)
      if (!match) {
        console.warn(`Could not parse cross-negative ID: ${case_.id}`)
        continue
      }
      const sourcePaper = match[1]
      const targetPaper = sourcePaper === '1910.11471' ? '1908.06606' : '1910.11471'
      const targetChunks = targetPaper === '1910.11471' ? paperAChunks : paperBChunks

      // Score query against all target chunks
      let maxLogit = -Infinity
      for (const chunk of targetChunks) {
        const input = tokenizer(case_.query, {
          text_pair: chunk.searchText,
          padding: true,
          truncation: true,
        })
        const outputs = await model(input)
        const logit = (outputs.logits.data as Float32Array)[0]!
        if (logit > maxLogit) maxLogit = logit
      }

      crossNegativeLogits.push(maxLogit)
      crossNegativeDetails.push({
        id: case_.id,
        query: case_.query,
        sourcePaper: sourcePaper!,
        targetPaper,
        maxLogit,
      })

      console.log(`${case_.id.padEnd(30)} | ${sourcePaper} → ${targetPaper} | max logit: ${maxLogit.toFixed(2).padStart(7)}`)
    }

    // Distribution analysis
    crossNegativeLogits.sort((a, b) => a - b)
    const minCross = crossNegativeLogits[0]!
    const maxCross = crossNegativeLogits[crossNegativeLogits.length - 1]!
    const medianCross = crossNegativeLogits[Math.floor(crossNegativeLogits.length / 2)]!

    console.log('')
    console.log('─'.repeat(120))
    console.log('CROSS-NEGATIVE LOGIT DISTRIBUTION')
    console.log('─'.repeat(120))
    console.log(`  Count:    ${crossNegativeLogits.length}`)
    console.log(`  Min:      ${minCross.toFixed(2)}`)
    console.log(`  Max:      ${maxCross.toFixed(2)}`)
    console.log(`  Median:   ${medianCross.toFixed(2)}`)
    console.log(`  Values:   ${crossNegativeLogits.map((l) => l.toFixed(2)).join(', ')}`)
    console.log('')

    // Compare with positives and unanswerables
    const positiveLogits = mainResults
      .filter((r) => r.kind === 'positive')
      .map((r) => r.maxLogit)
      .sort((a, b) => a - b)
    const unanswerableLogits = mainResults
      .filter((r) => r.kind === 'negative')
      .map((r) => r.maxLogit)
      .sort((a, b) => a - b)

    console.log('─'.repeat(120))
    console.log('COMPARISON ACROSS QUERY TYPES')
    console.log('─'.repeat(120))
    console.log('  Type              | Count | Min     | Max     | Median')
    console.log('  ------------------|-------|---------|---------|--------')
    console.log(`  Positive          | ${String(positiveLogits.length).padStart(5)} | ${positiveLogits[0]!.toFixed(2).padStart(7)} | ${positiveLogits[positiveLogits.length - 1]!.toFixed(2).padStart(7)} | ${positiveLogits[Math.floor(positiveLogits.length / 2)]!.toFixed(2).padStart(7)}`)
    console.log(`  Unanswerable      | ${String(unanswerableLogits.length).padStart(5)} | ${unanswerableLogits[0]!.toFixed(2).padStart(7)} | ${unanswerableLogits[unanswerableLogits.length - 1]!.toFixed(2).padStart(7)} | ${unanswerableLogits[Math.floor(unanswerableLogits.length / 2)]!.toFixed(2).padStart(7)}`)
    console.log(`  Cross-negative    | ${String(crossNegativeLogits.length).padStart(5)} | ${minCross.toFixed(2).padStart(7)} | ${maxCross.toFixed(2).padStart(7)} | ${medianCross.toFixed(2).padStart(7)}`)
    console.log('')

    // Threshold analysis
    const belowThreshold = crossNegativeLogits.filter((l) => l < -6.0).length
    const aboveThreshold = crossNegativeLogits.filter((l) => l >= -6.0).length

    console.log('─'.repeat(120))
    console.log('THRESHOLD -6.0 ANALYSIS')
    console.log('─'.repeat(120))
    console.log(`  Cross-negatives below -6.0 (correctly filtered): ${belowThreshold}/${crossNegativeLogits.length}`)
    console.log(`  Cross-negatives above -6.0 (would pass):         ${aboveThreshold}/${crossNegativeLogits.length}`)
    console.log('')

    if (aboveThreshold > 0) {
      console.log('  ⚠️  Cross-negatives overlap with positives and unanswerables.')
      console.log('      This suggests the threshold cannot reliably distinguish "answer exists" from')
      console.log('      "answer exists in a different document" from "no answer exists".')
      console.log('')
      console.log('  Cross-negatives above -6.0:')
      for (const detail of crossNegativeDetails) {
        if (detail.maxLogit >= -6.0) {
          console.log(`    ${detail.id.padEnd(30)} | logit: ${detail.maxLogit.toFixed(2).padStart(7)} | ${detail.sourcePaper} → ${detail.targetPaper}`)
        }
      }
    } else {
      console.log('  ✓ All cross-negatives correctly filtered by -6.0 threshold.')
    }

    console.log('')
    console.log('─'.repeat(120))
    console.log('VERDICT')
    console.log('─'.repeat(120))
    if (aboveThreshold > crossNegativeLogits.length / 2) {
      console.log('  Cross-negatives heavily overlap with positives.')
      console.log('  The threshold cannot distinguish "answer in this document" from "answer in other document".')
      console.log('  This is a strong argument for REMOVING abstention entirely.')
      console.log('  The threshold only filters completely off-domain queries (e.g., "Who wrote Hamlet?"),')
      console.log('  but fails for plausible domain queries without answers.')
    } else if (aboveThreshold > 0) {
      console.log('  Some cross-negatives pass the threshold, but most are filtered.')
      console.log('  The threshold provides partial protection against cross-document confusion.')
      console.log('  Whether to keep it depends on the use case: if users frequently ask questions')
      console.log('  about topics not in their library, the threshold helps. If they mostly ask')
      console.log('  about topics in their library, the threshold may cause false negatives.')
    } else {
      console.log('  All cross-negatives correctly filtered.')
      console.log('  The threshold successfully distinguishes "answer in this document" from')
      console.log('  "answer in other document" and "no answer exists".')
    }
  }, 300_000)

  it('compares Markdown vs plain-text chunking routes', async () => {
    console.log('\n' + '='.repeat(120))
    console.log('MARKDOWN vs PLAIN-TEXT CHUNKING COMPARISON')
    console.log('='.repeat(120))
    console.log('Testing whether losing section context (chunkText route) degrades retrieval quality')
    console.log('')

    // Load the same content
    const docs = loadMarkdownFixtures()

    // Chunk with chunkText instead of chunkMarkdown
    const plainTextChunks: ChunkShape[] = []
    for (const doc of docs) {
      // Strip Markdown headings to simulate plain-text input
      // In reality, .docx files go through mammoth which produces Markdown,
      // but for this test we want to isolate the effect of sectionPath
      const plainText = doc.content
        .split('\n')
        .filter((line) => !line.match(/^#+\s/)) // Remove heading lines
        .join('\n')

      const chunked = chunkText(plainText)
      const docChunks = chunked.map((c, i) => ({
        chunkId: `plain-${doc.documentId}::${i}`,
        documentId: doc.documentId,
        documentName: doc.documentName,
        text: c.text,
        searchText: c.searchText,
        sectionPath: c.sectionPath, // Will be empty for chunkText
        headingText: c.headingText, // Will be empty for chunkText
        chunkIndex: i,
      }))
      plainTextChunks.push(...docChunks)
    }

    console.log(`Markdown chunks (with sectionPath): ${chunks.length}`)
    console.log(`Plain-text chunks (no sectionPath): ${plainTextChunks.length}`)
    console.log('')

    // Generate embeddings for plain-text chunks
    console.log('Generating embeddings for plain-text chunks...')
    const plainTextEmbeddings = await getOrGenerateEmbeddings(plainTextChunks, resolve(CACHE_DIR, 'plain-text-embeddings.json'))
    console.log(`Generated ${plainTextEmbeddings.length} embeddings`)
    console.log('')

    // Build Orama index for plain-text chunks
    console.log('Building Orama index for plain-text chunks...')
    const plainTextDb = await createIndex(plainTextChunks, plainTextEmbeddings)
    console.log('Index built.')
    console.log('')

    // Load cross-encoder model
    console.log('Loading cross-encoder model...')
    const { AutoTokenizer, AutoModelForSequenceClassification } = await import('@huggingface/transformers')
    const tokenizer = await AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', CROSS_ENCODER_TOKENIZER_OPTIONS)
    const model = await AutoModelForSequenceClassification.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', { dtype: 'q8' })
    console.log('Model loaded.')
    console.log('')

    // Run retrieval for each positive query on plain-text index
    console.log('Running retrieval on plain-text index...')
    const plainTextResults: Array<{ id: string; ndcg10: number; hit10: number }> = []

    for (let qi = 0; qi < QASPER_POSITIVE_CASES.length; qi++) {
      const case_ = QASPER_POSITIVE_CASES[qi]!
      const queryEmbedding = queryEmbeddings[qi]!

      // Hybrid search
      const searchResults = await search(plainTextDb, {
        mode: 'hybrid',
        term: case_.query,
        vector: { value: queryEmbedding, property: 'embedding' },
        limit: 50,
        includeVectors: false,
        similarity: 0.0,
        hybridWeights: { text: 0.25, vector: 0.75 },
        threshold: 0.5,
      })

      const hits = searchResults.hits.map((hit) => ({
        chunkId: hit.document.chunkId as string,
        text: hit.document.text as string,
        searchText: hit.document.searchText as string,
      }))

      // Cross-encoder reranking
      const candidates = hits.slice(0, 40)
      const scored = []
      for (const hit of candidates) {
        const input = tokenizer(case_.query, {
          text_pair: hit.searchText,
          padding: true,
          truncation: true,
        })
        const outputs = await model(input)
        const logit = (outputs.logits.data as Float32Array)[0]!
        scored.push({ ...hit, logit })
      }
      scored.sort((a, b) => b.logit - a.logit)

      // Calculate metrics
      const top10 = scored.slice(0, 10)
      const rels = relevanceVector(top10, case_)
      const ndcg10 = ndcgAtK(rels, 10)
      const hit10 = hitAtKGraded(rels, 10)

      plainTextResults.push({ id: case_.id, ndcg10, hit10 })
    }

    // Compare with Markdown results
    const markdownResults = mainResults.filter((r) => r.kind === 'positive')

    const markdownAvgNdcg10 = markdownResults.reduce((sum, r) => sum + r.ndcg10, 0) / markdownResults.length
    const markdownAvgHit10 = markdownResults.reduce((sum, r) => sum + r.hit10, 0) / markdownResults.length
    const plainTextAvgNdcg10 = plainTextResults.reduce((sum, r) => sum + r.ndcg10, 0) / plainTextResults.length
    const plainTextAvgHit10 = plainTextResults.reduce((sum, r) => sum + r.hit10, 0) / plainTextResults.length

    console.log('─'.repeat(120))
    console.log('METRICS COMPARISON')
    console.log('─'.repeat(120))
    console.log('  Route              | nDCG@10 | Hit@10')
    console.log('  -------------------|---------|--------')
    console.log(`  Markdown           | ${markdownAvgNdcg10.toFixed(4).padStart(7)} | ${markdownAvgHit10.toFixed(4).padStart(7)}`)
    console.log(`  Plain-text         | ${plainTextAvgNdcg10.toFixed(4).padStart(7)} | ${plainTextAvgHit10.toFixed(4).padStart(7)}`)
    console.log(`  Δ                  | ${(plainTextAvgNdcg10 - markdownAvgNdcg10).toFixed(4).padStart(7)} | ${(plainTextAvgHit10 - markdownAvgHit10).toFixed(4).padStart(7)}`)
    console.log('')

    // Per-query comparison
    console.log('─'.repeat(120))
    console.log('PER-QUERY COMPARISON')
    console.log('─'.repeat(120))
    console.log('  Case ID                  | Markdown nDCG@10 | Plain-text nDCG@10 | Δ')
    console.log('  -------------------------|------------------|--------------------|--------')

    for (let i = 0; i < QASPER_POSITIVE_CASES.length; i++) {
      const caseId = QASPER_POSITIVE_CASES[i]!.id
      const mdResult = markdownResults.find((r) => r.id === caseId)!
      const ptResult = plainTextResults[i]!
      const delta = ptResult.ndcg10 - mdResult.ndcg10

      console.log(`  ${caseId.padEnd(25)} | ${mdResult.ndcg10.toFixed(4).padStart(16)} | ${ptResult.ndcg10.toFixed(4).padStart(18)} | ${delta >= 0 ? '+' : ''}${delta.toFixed(4).padStart(6)}`)
    }

    console.log('')
    console.log('─'.repeat(120))
    console.log('INTERPRETATION')
    console.log('─'.repeat(120))

    const ndcgDrop = markdownAvgNdcg10 - plainTextAvgNdcg10
    const hitDrop = markdownAvgHit10 - plainTextAvgHit10

    if (ndcgDrop > 0.05 || hitDrop > 0.05) {
      console.log('  ⚠️  SIGNIFICANT DEGRADATION DETECTED')
      console.log(`      nDCG@10 dropped by ${(ndcgDrop * 100).toFixed(1)} percentage points`)
      console.log(`      Hit@10 dropped by ${(hitDrop * 100).toFixed(1)} percentage points`)
      console.log('')
      console.log('  This confirms the hypothesis: losing section context (sectionPath) degrades retrieval.')
      console.log('  The Markdown route prepends sectionPath to embedding text, providing hierarchical context.')
      console.log('  The plain-text route has no sectionPath, so embeddings lack this structural information.')
      console.log('')
      console.log('  IMPACT: .docx files go through mammoth (produces Markdown) but then chunkText is used')
      console.log('  because isStructuredMarkdown is false for .docx in ingest.service.ts.')
      console.log('  This means .docx files lose section context during chunking, degrading retrieval quality.')
      console.log('')
      console.log('  RECOMMENDATION: Treat .docx as structured Markdown (set isStructuredMarkdown = true for .docx)')
      console.log('  so they use chunkMarkdown and preserve section hierarchy.')
    } else if (ndcgDrop > 0.01 || hitDrop > 0.01) {
      console.log('  ⚠️  MINOR DEGRADATION DETECTED')
      console.log(`      nDCG@10 dropped by ${(ndcgDrop * 100).toFixed(1)} percentage points`)
      console.log(`      Hit@10 dropped by ${(hitDrop * 100).toFixed(1)} percentage points`)
      console.log('')
      console.log('  There is a small cost to losing section context, but it may not be operationally significant.')
      console.log('  Further investigation with more documents would help determine if this is noise or signal.')
    } else {
      console.log('  ✓ NO SIGNIFICANT DEGRADATION')
      console.log(`      nDCG@10 difference: ${(ndcgDrop * 100).toFixed(1)} percentage points`)
      console.log(`      Hit@10 difference: ${(hitDrop * 100).toFixed(1)} percentage points`)
      console.log('')
      console.log('  Losing section context does not significantly impact retrieval quality on this dataset.')
      console.log('  This could mean:')
      console.log('    1. The section hierarchy is not critical for these particular documents')
      console.log('    2. The embedding model captures enough semantic meaning without explicit section context')
      console.log('    3. The test set is too small to detect a real difference')
    }
  }, 300_000)
})
