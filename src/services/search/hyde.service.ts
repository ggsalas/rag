import { embed } from '@/services/embedding/embedding.service'
import {
  searchHybrid,
  type VectorSearchResult,
} from '@/services/embedding/vector-store'
import { generateOnce } from '@/services/llm/llm.service'
import { getChunksByLibrary } from '@/services/chunk.service'
import type { HybridWeights } from '@/types/search'
import {
  HYDE_NUM_SAMPLES,
  HYDE_LIBRARY_SAMPLES,
  HYDE_RRF_K,
  HYDE_MAX_TOKENS,
  HYDE_TIMEOUT_MS,
} from '@/lib/constants'
import { rrfFuse } from './rrf'

/**
 * HyDE (Hypothetical Document Embeddings) — improves retrieval on short or
 * relational queries by generating N hypothetical answer passages and fusing
 * N+1 hybrid searches with Reciprocal Rank Fusion.
 *
 * Pipeline: sample library chunks (cached) → LLM generates N passages in the
 * library's own style → embed original query + N passages in parallel → run
 * N+1 hybrid searches in parallel → RRF-fuse the rankings → return top-K.
 *
 * This module is self-contained: removing HyDE = deleting this file and
 * the branch in `search.service.ts`.
 */

interface LibrarySampleCache {
  samples: string[]
  chunkCount: number
}

const sampleCache = new Map<string, LibrarySampleCache>()

/**
 * Returns a few representative chunks from a library to prime the LLM's
 * generation style. Deterministic across sessions: chunks are sorted by ID
 * (stable) and picked at evenly-spaced positions, so the same library always
 * yields the same samples. Cached per libraryId + chunkCount; invalidated
 * when documents are added or removed.
 */
async function getLibrarySamples(libraryId: string): Promise<string[]> {
  const chunks = await getChunksByLibrary(libraryId)
  const cached = sampleCache.get(libraryId)
  if (cached && cached.chunkCount === chunks.length) return cached.samples

  if (chunks.length === 0) {
    sampleCache.set(libraryId, { samples: [], chunkCount: 0 })
    return []
  }

  // Sort by chunk ID for a stable order, then pick evenly-spaced samples
  // across the library. Deterministic → the same library always primes the
  // LLM with the same passages → same query yields the same HyDE output.
  const sorted = [...chunks].sort((a, b) => a.id.localeCompare(b.id))
  const step = Math.max(1, Math.floor(sorted.length / HYDE_LIBRARY_SAMPLES))
  const picked: typeof sorted = []
  for (let i = 0; i < HYDE_LIBRARY_SAMPLES && i * step < sorted.length; i++) {
    picked.push(sorted[i * step]!)
  }
  const samples = picked
    .map((c) => c.text.trim())
    .filter((t) => t.length > 0)

  sampleCache.set(libraryId, { samples, chunkCount: chunks.length })
  return samples
}

/**
 * Asks the LLM to generate N hypothetical answer passages in the style of the
 * given library. Samples ground the LLM in the domain/vocabulary/tone of the
 * corpus so a legal library gets legal-style hypothetical passages, a bio
 * library gets bio-style, etc.
 */
async function generateHypotheticalPassages(
  query: string,
  libraryId: string,
): Promise<string[]> {
  const samples = await getLibrarySamples(libraryId)

  const styleBlock =
    samples.length > 0
      ? `Here are ${samples.length} example passages from the collection (they show the domain, style and vocabulary you should imitate):\n\n` +
        samples.map((s, i) => `Example ${i + 1}:\n${s}`).join('\n\n---\n\n') +
        '\n\n'
      : ''

  const prompt =
    styleBlock +
    `Task: given the user's question below, write ${HYDE_NUM_SAMPLES} short sentences that all answer THE SAME question with different wordings. These sentences are used ONLY to seed a semantic vector search — they must be tightly focused on the exact information the question asks about.\n\n` +
    `CRITICAL — stay minimal:\n` +
    `- Every sentence must contain the key noun(s) from the question. If the question asks about "mother", every sentence is about the mother (NOT father, stepfather, grandmother).\n` +
    `- Do NOT add unrelated context. No career, no profession, no bands, no albums, no awards, no dates unless the question asks for them.\n` +
    `- If you invent a placeholder name, add NOTHING about that person beyond what the question relation needs.\n\n` +
    `Format:\n` +
    `- Output ONLY the ${HYDE_NUM_SAMPLES} sentences, numbered 1., 2., 3.\n` +
    `- One sentence per line. No preamble, no headings, no explanation.\n` +
    `- Each sentence should be short (10-20 words) and self-contained.\n\n` +
    `Example — question "who is her father?":\n` +
    `1. Her father is James Parnell.\n` +
    `2. She is the daughter of James Parnell.\n` +
    `3. James Parnell is her father.\n\n` +
    `Question: ${query}`

  // Temperature 0 → greedy decoding (argmax at every step). Any residual
  // variation between runs comes from WebGPU floating-point non-determinism,
  // not from sampling.
  const raw = await generateOnce(prompt, HYDE_MAX_TOKENS, 0)
  console.log('HyDE raw output:', raw)
  return parseNumberedList(raw).slice(0, HYDE_NUM_SAMPLES)
}

/**
 * Extracts sentences from an LLM output formatted as a numbered list.
 * Tolerant to slight formatting drift (extra whitespace, dashes, etc.).
 */
function parseNumberedList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|-|\*)\s*/, '').trim())
    .filter((line) => line.length > 0)
}

/** Wraps a promise in a timeout that rejects if not resolved in time. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    )
    p.then((v) => {
      clearTimeout(timer)
      resolve(v)
    }).catch((e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

/**
 * Runs a HyDE-augmented search. Returns fused results; on any failure (LLM
 * error, timeout, empty output), throws so the caller can fall back to a
 * plain search.
 */
export async function searchWithHyDE(
  query: string,
  libraryId: string,
  maxResults: number,
  weights?: HybridWeights,
): Promise<VectorSearchResult[]> {
  const passages = await withTimeout(
    generateHypotheticalPassages(query, libraryId),
    HYDE_TIMEOUT_MS,
    'HyDE generation',
  )

  if (passages.length === 0) {
    throw new Error('HyDE produced no passages')
  }

  // Original query embedding + N hypothetical passage embeddings, in parallel
  const embeddings = await Promise.all([
    embed(query),
    ...passages.map((p) => embed(p)),
  ])

  // N+1 hybrid searches in parallel. All use the ORIGINAL query for the BM25
  // channel (keyword signal is the user's actual intent), but each uses a
  // different vector for the semantic channel.
  //
  // Note: we over-fetch (maxResults * 2) per ranking to give RRF enough
  // material to fuse; RRF thrives on longer lists.
  const perRankingLimit = Math.max(maxResults * 2, 20)
  const rankings = await Promise.all(
    embeddings.map((emb) =>
      searchHybrid(libraryId, query, emb, perRankingLimit, weights),
    ),
  )

  return rrfFuse(rankings, (r) => r.chunkId, HYDE_RRF_K, maxResults)
}

/** Clears the library sample cache. Exposed for tests and manual invalidation. */
export function clearHyDESampleCache(libraryId?: string): void {
  if (libraryId) sampleCache.delete(libraryId)
  else sampleCache.clear()
}
