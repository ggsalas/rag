/**
 * @vitest-environment node
 *
 * Diagnostic: investigate why first-album still fails after cross-encoder reranking.
 * Shows the top-20 chunks by cross-encoder logit and whether they contain the
 * relevant fragments.
 *
 * GATED: only runs when FIRST_ALBUM_DIAGNOSTIC=1 env var is set.
 */

import { describe, it, beforeAll } from 'vitest'
import { create, insert, search, type AnyOrama } from '@orama/orama'
import { resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import {
  POSITIVE_CASES_V2,
} from './search-benchmark.dataset.v2'
import { chunkRelevanceGrade } from './search-benchmark.relevance'
import { chunkMarkdown } from '@/services/ingest/chunking.service'
import { normalizeMarkdown } from '@/services/ingest/markdown/normalize-markdown.service'
import { ENGLISH_STOP_WORDS_ARRAY } from '@/lib/stop-words'
import { EMBEDDING_DIMENSIONS } from '@/lib/constants'

const FIXTURE_PATH = resolve(__dirname, '../../fixtures', 'britnet-corpus.json')
const EMBEDDINGS_CACHE_DIR = resolve(__dirname, '../../fixtures', '.embedding-cache')
const NEW_EMBEDDINGS_CACHE = resolve(EMBEDDINGS_CACHE_DIR, 'new-chunks-embeddings.json')
const QUERY_EMBEDDINGS_CACHE = resolve(EMBEDDINGS_CACHE_DIR, 'query-embeddings.json')
const CROSS_ENCODER_CACHE = resolve(EMBEDDINGS_CACHE_DIR, 'cross-encoder-scores.json')

const RUN_DIAGNOSTIC = process.env.FIRST_ALBUM_DIAGNOSTIC === '1'

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

describe.skipIf(!RUN_DIAGNOSTIC)('First-Album Diagnostic', () => {
  let chunks: ChunkShape[]
  let embeddings: number[][]
  let queryEmbeddings: number[][]
  let db: AnyOrama
  let ceScores: Map<string, number>

  beforeAll(async () => {
    const { content, documentId, documentName } = loadRawContent()
    chunks = rechunkNew(content, documentId, documentName)
    embeddings = await getOrGenerateEmbeddings(chunks, NEW_EMBEDDINGS_CACHE, 'new')
    const queries = POSITIVE_CASES_V2.map((c) => c.query)
    queryEmbeddings = await getOrGenerateQueryEmbeddings(queries)
    db = await createIndex(chunks, embeddings)

    // Load cross-encoder scores
    const cached = JSON.parse(readFileSync(CROSS_ENCODER_CACHE, 'utf-8')) as Array<{
      query: string
      chunkId: string
      score: number
    }>
    ceScores = new Map<string, number>()
    for (const c of cached) {
      ceScores.set(`${c.query}|||${c.chunkId}`, c.score)
    }
  }, 300_000)

  it('shows top-20 chunks for first-album by cross-encoder logit', async () => {
    const case_ = POSITIVE_CASES_V2.find((c) => c.id === 'first-album')!
    const queryIdx = POSITIVE_CASES_V2.indexOf(case_)
    const embedding = queryEmbeddings[queryIdx]!

    // Get hybrid retrieval results
    const hybridResults = await search(db, {
      mode: 'hybrid',
      term: case_.query,
      vector: { value: embedding, property: 'embedding' },
      properties: ['searchText', 'headingText'],
      limit: 50,
      includeVectors: false,
      similarity: 0.0,
      hybridWeights: { text: 0.25, vector: 0.75 },
      threshold: 0.5,
    })

    console.log('\n' + '='.repeat(120))
    console.log(`FIRST-ALBUM DIAGNOSTIC: "${case_.query}"`)
    console.log('Fragments:', case_.fragments.map((f) => `[g${f.grade}] "${f.text}"`).join(' | '))
    console.log('='.repeat(120))

    // Get cross-encoder scores for all chunks
    const scored = hybridResults.hits.map((hit) => {
      const chunkId = hit.document.chunkId as string
      const key = `${case_.query}|||${chunkId}`
      const ceScore = ceScores.get(key) ?? -100
      const chunk = chunks.find((c) => c.chunkId === chunkId)!
      const grade = chunkRelevanceGrade(
        { chunkId: chunk.chunkId, text: chunk.text, searchText: chunk.searchText },
        case_,
      )
      return {
        chunkId,
        hybridScore: hit.score,
        ceScore,
        grade,
        searchText: chunk.searchText,
      }
    })

    // Sort by CE score
    scored.sort((a, b) => b.ceScore - a.ceScore)

    console.log('\nTop-20 chunks by cross-encoder logit:')
    console.log('Rank | CE Logit | Hybrid | Grade | Text preview')
    console.log('-----|----------|--------|-------|-------------')
    for (let i = 0; i < 20 && i < scored.length; i++) {
      const s = scored[i]!
      const marker = s.grade > 0 ? `✓ g${s.grade}` : '  no'
      console.log(
        `${(i + 1).toString().padStart(4)} | ${s.ceScore.toFixed(2).padStart(8)} | ${s.hybridScore.toFixed(3).padStart(6)} | ${marker.padStart(5)} | ${s.searchText.slice(0, 80).replace(/\n/g, ' ')}...`,
      )
    }

    // Find the correct chunk
    const correctChunk = scored.find((s) => s.grade > 0)
    if (correctChunk) {
      const rank = scored.indexOf(correctChunk) + 1
      console.log(`\n✓ Correct chunk found at rank ${rank} with logit ${correctChunk.ceScore.toFixed(2)}`)
      console.log(`  Text: "${correctChunk.searchText.slice(0, 200)}..."`)

      // Show chunks ranked above it
      if (rank > 1) {
        console.log(`\nChunks ranked above the correct one (${rank - 1} chunks):`)
        for (let i = 0; i < rank - 1 && i < 10; i++) {
          const s = scored[i]!
          console.log(`  ${i + 1}. logit=${s.ceScore.toFixed(2)}: "${s.searchText.slice(0, 100).replace(/\n/g, ' ')}..."`)
        }
      }
    } else {
      console.log('\n✗ Correct chunk NOT FOUND in top-50!')
    }
  }, 60_000)
})
