import { getRerankerWorker } from '@/infrastructure/worker-pool'
import type { RerankerLoadProgressCallback } from '@/workers/reranker.worker'
import type { SearchResult } from '@/types/search'

/**
 * Cross-encoder reranker service.
 *
 * Loads the MS-MARCO MiniLM-L-6 cross-encoder model on demand and uses it to
 * rerank a list of search results. The model runs in a dedicated Web Worker
 * via Comlink.
 *
 * DEGRADATION: If the model fails to load or score, the service returns the
 * input results in their original order. This ensures the search pipeline
 * never breaks — it just falls back to the pre-reranker ranking.
 *
 * Store integration: the caller (hook/route layer) passes an onProgress callback
 * that updates the Zustand store. The service itself does NOT import from store/.
 */

let loadPromise: Promise<boolean> | null = null
let isLoaded = false
let loadFailed = false

/**
 * Loads the cross-encoder model. Idempotent: if already loaded, returns
 * immediately. If a load is in progress, waits for it. If a previous load
 * failed, returns false (degraded mode).
 *
 * The caller should pass an onProgress callback that updates the Zustand
 * store (e.g., setRerankerProgress). The service itself does not import store/.
 */
export async function loadRerankerModel(
  onProgress?: RerankerLoadProgressCallback,
): Promise<boolean> {
  if (isLoaded) return true
  if (loadFailed) return false
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      const worker = getRerankerWorker()
      await worker.loadModel(onProgress)
      isLoaded = true
      return true
    } catch (error) {
      console.error('[CrossEncoderReranker] Failed to load model:', error)
      loadFailed = true
      return false
    }
  })()

  return loadPromise
}

/** Returns whether the cross-encoder model is ready to use */
export function isRerankerReady(): boolean {
  return isLoaded
}

/** Returns whether the cross-encoder model failed to load (degraded mode) */
export function isRerankerDegraded(): boolean {
  return loadFailed
}

/**
 * Resets the load state so a failed load can be retried.
 *
 * After a failed load, `loadRerankerModel` returns `false` immediately without
 * retrying. Calling this clears the failure flag and the cached promise so the
 * next call to `loadRerankerModel` attempts a fresh load.
 */
export function resetRerankerLoadState(): void {
  loadPromise = null
  loadFailed = false
  // isLoaded stays as-is — if it was true, the model is still usable.
}

/**
 * Reranks a list of search results using the cross-encoder model.
 *
 * For each candidate, computes a relevance score by scoring the pair
 * (query, candidate.searchText) with the cross-encoder. The results are
 * sorted by this score in descending order.
 *
 * DEGRADATION: If the model is not loaded or scoring fails, returns the
 * input results in their original order. The `rerankScore` field is only
 * set when the cross-encoder successfully scores the pairs.
 *
 * @param query - The search query
 * @param candidates - The search results to rerank
 * @returns The reranked results with `rerankScore` set (if successful)
 */
export async function rerankWithCrossEncoder(
  query: string,
  candidates: SearchResult[],
): Promise<SearchResult[]> {
  if (candidates.length === 0) return []

  // If the model is not ready, return input order (degraded mode)
  if (!isLoaded) {
    return candidates
  }

  try {
    const worker = getRerankerWorker()
    const pairs = candidates.map((c) => [query, c.searchText] as [string, string])
    const scores = await worker.scorePairs(pairs)

    // Attach scores and sort
    const scored = candidates.map((c, i) => ({
      result: c,
      score: scores[i] ?? 0,
    }))

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.result.chunkId.localeCompare(b.result.chunkId)
    })

    return scored.map(({ result, score }) => ({
      ...result,
      rerankScore: score,
    }))
  } catch (error) {
    console.error('[CrossEncoderReranker] Scoring failed, returning input order:', error)
    return candidates
  }
}
