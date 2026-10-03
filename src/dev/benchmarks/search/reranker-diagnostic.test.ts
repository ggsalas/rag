/**
 * @vitest-environment node
 *
 * Diagnostic test: for each of the 4 failing cases (debut-single, first-album,
 * toxic-album, second-album), find the chunk that contains the grade-2 fragment,
 * determine its rank in the hybrid search results, and show the top-10 competing
 * chunks.
 *
 * GATED: only runs when RERANKER_DIAGNOSTIC=1 env var is set.
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

const RUN_DIAGNOSTIC = process.env.RERANKER_DIAGNOSTIC === '1'

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
  const { pipeline } = await import('@huggingface/transformers')
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' })
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
  return generateEmbeddings(queries)
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

describe.skipIf(!RUN_DIAGNOSTIC)('Reranker Diagnostic', () => {
  let chunks: ChunkShape[]
  let embeddings: number[][]
  let queryEmbeddings: number[][]
  let db: AnyOrama

  beforeAll(async () => {
    const { content, documentId, documentName } = loadRawContent()
    chunks = rechunkNew(content, documentId, documentName)
    embeddings = await getOrGenerateEmbeddings(chunks, NEW_EMBEDDINGS_CACHE, 'new')
    const queries = POSITIVE_CASES_V2.map((c) => c.query)
    queryEmbeddings = await getOrGenerateQueryEmbeddings(queries)
    db = await createIndex(chunks, embeddings)
  }, 300_000)

  it('diagnoses the 4 failing cases: rank of correct chunk and top-10 competitors', async () => {
    const failingIds = ['debut-single', 'first-album', 'toxic-album', 'second-album']
    const failingCases = POSITIVE_CASES_V2.filter((c) => failingIds.includes(c.id))

    // Find which chunks contain the grade-2 fragments for each case
    console.log('\n' + '='.repeat(120))
    console.log('STEP 1: Which chunks contain the relevant fragments?')
    console.log('='.repeat(120))

    for (const c of failingCases) {
      console.log(`\n  ${c.id}: "${c.query}"`)
      const grade2Fragments = c.fragments.filter((f) => f.grade === 2)
      for (const frag of grade2Fragments) {
        const normFrag = frag.text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
        const containingChunks = chunks.filter((ch) => {
          const normText = ch.searchText.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
          return normText.includes(normFrag)
        })
        console.log(`    Fragment [g${frag.grade}]: "${frag.text.slice(0, 80)}..."`)
        console.log(`    Found in ${containingChunks.length} chunk(s):`)
        for (const ch of containingChunks) {
          const grade = chunkRelevanceGrade({ chunkId: ch.chunkId, text: ch.text, searchText: ch.searchText }, c)
          console.log(`      ${ch.chunkId} (grade=${grade}): "${ch.searchText.slice(0, 120)}..."`)
        }
      }
    }

    // Run hybrid search and show ranks
    console.log('\n' + '='.repeat(120))
    console.log('STEP 2: Rank of correct chunk in hybrid search (0.25/0.75 weights, top-50)')
    console.log('='.repeat(120))

    for (let qi = 0; qi < failingCases.length; qi++) {
      const c = failingCases[qi]!
      const queryIdx = POSITIVE_CASES_V2.indexOf(c)
      const embedding = queryEmbeddings[queryIdx]!

      const results = await search(db, {
        mode: 'hybrid',
        term: c.query,
        vector: { value: embedding, property: 'embedding' },
        properties: ['searchText', 'headingText'],
        limit: 50,
        includeVectors: false,
        similarity: 0.0,
        hybridWeights: { text: 0.25, vector: 0.75 },
        threshold: 1.0,
      })

      console.log(`\n  ${c.id}: "${c.query}"`)
      console.log(`  Total candidates: ${results.hits.length}`)

      // Find rank of relevant chunks
      const relevantRanks: number[] = []
      for (let i = 0; i < results.hits.length; i++) {
        const hit = results.hits[i]!
        const chunk = { chunkId: hit.document.chunkId as string, text: hit.document.text as string, searchText: hit.document.searchText as string }
        const grade = chunkRelevanceGrade(chunk, c)
        if (grade > 0) {
          relevantRanks.push(i + 1)
          console.log(`    ✓ Rank ${i + 1}: grade=${grade} score=${hit.score.toFixed(4)} chunkId=${chunk.chunkId}`)
          console.log(`      text: "${chunk.searchText.slice(0, 150)}..."`)
        }
      }
      if (relevantRanks.length === 0) {
        console.log(`    ✗ NO relevant chunk in top-50!`)
      }

      // Show top-10 competitors
      console.log(`  Top-10 results:`)
      for (let i = 0; i < Math.min(10, results.hits.length); i++) {
        const hit = results.hits[i]!
        const chunk = { chunkId: hit.document.chunkId as string, text: hit.document.text as string, searchText: hit.document.searchText as string }
        const grade = chunkRelevanceGrade(chunk, c)
        const marker = grade > 0 ? '✓' : ' '
        console.log(`    ${marker} ${i + 1}. score=${hit.score.toFixed(4)} grade=${grade} "${chunk.searchText.slice(0, 100)}..."`)
      }
    }

    // Also check vector-only to see if the embedding similarity is the issue
    console.log('\n' + '='.repeat(120))
    console.log('STEP 3: Vector-only rank of correct chunk (to isolate BM25 vs embedding issue)')
    console.log('='.repeat(120))

    for (let qi = 0; qi < failingCases.length; qi++) {
      const c = failingCases[qi]!
      const queryIdx = POSITIVE_CASES_V2.indexOf(c)
      const embedding = queryEmbeddings[queryIdx]!

      const results = await search(db, {
        mode: 'vector',
        vector: { value: embedding, property: 'embedding' },
        limit: 50,
        includeVectors: false,
        similarity: 0.0,
      })

      console.log(`\n  ${c.id}: "${c.query}"`)
      for (let i = 0; i < results.hits.length; i++) {
        const hit = results.hits[i]!
        const chunk = { chunkId: hit.document.chunkId as string, text: hit.document.text as string, searchText: hit.document.searchText as string }
        const grade = chunkRelevanceGrade(chunk, c)
        if (grade > 0) {
          console.log(`    ✓ Vector rank ${i + 1}: grade=${grade} score=${hit.score.toFixed(4)}`)
        }
      }
    }
  }, 120_000)
})
