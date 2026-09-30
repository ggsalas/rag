import { getRerankerWorker } from '@/infrastructure/worker-pool'
import type { RerankerLoadProgressCallback } from '@/workers/reranker.worker'
import type { SearchResult } from '@/types/search'

/**
 * Cross-encoder service.
 *
 * Loads the MS-MARCO MiniLM-L-6 cross-encoder model on demand and uses it to
 * rank a list of search results. The model runs in a dedicated Web Worker
 * via Comlink.
 *
 * The cross-encoder is mandatory for search. If the model fails to load or
 * scoring fails, an error is thrown — the search pipeline does NOT fall back
 * to unranked results. The UI layer should catch the error and surface a
 * retry action.
 *
 * Store integration: the caller (hook/route layer) passes an onProgress callback
 * that updates the Zustand store. The service itself does NOT import from store/.
 */

let loadPromise: Promise<boolean> | null = null
let isCrossEncoderLoaded = false
let crossEncoderLoadFailed = false

/**
 * Error thrown when the cross-encoder model is not ready or scoring fails.
 * The UI layer should catch this and surface a retry action.
 */
export class CrossEncoderNotReadyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CrossEncoderNotReadyError'
  }
}

/**
 * Loads the cross-encoder model. Idempotent: if already loaded, returns
 * immediately. If a load is in progress, waits for it. If a previous load
 * failed, returns false.
 *
 * The caller should pass an onProgress callback that updates the Zustand
 * store (e.g., setCrossEncoderProgress). The service itself does not import store/.
 */
export async function loadCrossEncoderModel(
  onProgress?: RerankerLoadProgressCallback,
): Promise<boolean> {
  if (isCrossEncoderLoaded) return true
  if (crossEncoderLoadFailed) return false
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      const worker = getRerankerWorker()
      await worker.loadModel(onProgress)
      isCrossEncoderLoaded = true
      return true
    } catch (error) {
      console.error('[CrossEncoder] Failed to load model:', error)
      crossEncoderLoadFailed = true
      return false
    }
  })()

  return loadPromise
}

/** Returns whether the cross-encoder model is ready to use */
export function isCrossEncoderReady(): boolean {
  return isCrossEncoderLoaded
}

/**
 * Resets the load state so a failed load can be retried.
 *
 * After a failed load, `loadCrossEncoderModel` returns `false` immediately without
 * retrying. Calling this clears the failure flag and the cached promise so the
 * next call to `loadCrossEncoderModel` attempts a fresh load.
 */
export function resetCrossEncoderLoadState(): void {
  loadPromise = null
  crossEncoderLoadFailed = false
  // isCrossEncoderLoaded stays as-is — if it was true, the model is still usable.
}

/**
 * Ranks a list of search results using the cross-encoder model.
 *
 * For each candidate, computes a relevance score by scoring the pair
 * (query, candidate.searchText) with the cross-encoder. The results are
 * sorted by this score in descending order.
 *
 * Throws `CrossEncoderNotReadyError` if the model is not loaded or if scoring
 * fails. The search pipeline depends on this — there is no fallback to
 * unranked results.
 *
 * @param query - The search query
 * @param candidates - The search results to rank
 * @returns The ranked results with `rerankScore` set
 * @throws {CrossEncoderNotReadyError} if the model is not ready or scoring fails
 */
export async function rankWithCrossEncoder(
  query: string,
  candidates: SearchResult[],
): Promise<SearchResult[]> {
  if (candidates.length === 0) return []

  if (!isCrossEncoderLoaded) {
    throw new CrossEncoderNotReadyError(
      'Cross-encoder model is not loaded. Cannot rank search results.',
    )
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
    console.error('[CrossEncoder] Scoring failed:', error)
    throw new CrossEncoderNotReadyError(
      `Cross-encoder scoring failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
  }
}
