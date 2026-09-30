import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@/store/app.store'
import { initEmbeddingModel } from '@/services/embedding/embedding.service'
import {
  loadRerankerModel,
  resetRerankerLoadState,
} from '@/services/search/cross-encoder-reranker.service'
import type { RerankerLoadProgressCallback } from '@/workers/reranker.worker'

/**
 * Combined model status for the search pipeline.
 *
 * - `idle`: neither model has started loading.
 * - `loading`: at least one model is still loading.
 * - `ready`: both models are loaded and search is available.
 * - `error`: at least one model failed to load — search is blocked.
 */
export type SearchModelsStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Callbacks to notify the consumer about model loading lifecycle */
export interface SearchModelsCallbacks {
  onLoadStart: () => void
  onLoadEnd: () => void
  onLoadError: (message: string) => void
}

/**
 * Derives a combined search-models status from the per-model Zustand slices.
 *
 * - Both `ready` → `ready`
 * - Any `error` → `error`
 * - Any `loading` or one `ready` + other `idle` → `loading`
 * - Both `idle` → `idle`
 */
export function combineSearchModelsStatus(
  embeddingStatus: 'idle' | 'loading' | 'ready' | 'error',
  rerankerStatus: 'idle' | 'loading' | 'ready' | 'error',
): SearchModelsStatus {
  if (embeddingStatus === 'ready' && rerankerStatus === 'ready') return 'ready'
  if (embeddingStatus === 'error' || rerankerStatus === 'error') return 'error'
  if (embeddingStatus === 'loading' || rerankerStatus === 'loading') return 'loading'
  // Both idle, or one idle + other not yet loading
  if (embeddingStatus === 'idle' && rerankerStatus === 'idle') return 'idle'
  // Mixed idle/loading → still loading
  return 'loading'
}

/**
 * Initializes both the embedding model and the cross-encoder reranker in
 * parallel, tracking their progress in the global Zustand store.
 *
 * Search is considered enabled only when BOTH models are `ready`. While either
 * is `loading`, the UI should show progress. If either enters `error`, the
 * user can call `retry()` to attempt both again.
 *
 * The hook is idempotent: calling it from multiple components (or on re-render)
 * does not restart already-running loads. Models are loaded on demand when the
 * hook first mounts — typically when entering the search route.
 */
export function useSearchModels(callbacks: SearchModelsCallbacks) {
  const embeddingStatus = useAppStore((s) => s.embeddingStatus)
  const setEmbeddingStatus = useAppStore((s) => s.setEmbeddingStatus)
  const setEmbeddingProgress = useAppStore((s) => s.setEmbeddingProgress)
  const rerankerStatus = useAppStore((s) => s.rerankerStatus)
  const setRerankerStatus = useAppStore((s) => s.setRerankerStatus)
  const setRerankerProgress = useAppStore((s) => s.setRerankerProgress)

  // Stable ref for callbacks so the effect doesn't re-run on every render.
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  // Track whether a load cycle has been started so we don't restart on re-render.
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    // Only start if both are idle (fresh mount). If either is already
    // loading/ready/error, leave it alone — a previous invocation or a retry
    // is in charge.
    if (embeddingStatus !== 'idle' || rerankerStatus !== 'idle') return
    startedRef.current = true

    const { onLoadStart, onLoadEnd, onLoadError } = callbacksRef.current
    onLoadStart()
    setEmbeddingStatus('loading')
    setEmbeddingProgress(0)
    setRerankerStatus('loading')
    setRerankerProgress(0)

    const embeddingPromise = initEmbeddingModel((progress) =>
      setEmbeddingProgress(Math.round(progress * 100)),
    )
      .then(() => {
        setEmbeddingStatus('ready')
      })
      .catch((error) => {
        console.error('[useSearchModels] Failed to load embedding model:', error)
        setEmbeddingStatus('error')
        onLoadError(
          error instanceof Error ? error.message : 'Failed to load embedding model',
        )
      })

    const rerankerProgressCallback: RerankerLoadProgressCallback = (progress) =>
      setRerankerProgress(Math.round(progress * 100))

    const rerankerPromise = loadRerankerModel(rerankerProgressCallback)
      .then((ok) => {
        if (ok) {
          setRerankerStatus('ready')
        } else {
          setRerankerStatus('error')
          onLoadError('Failed to load cross-encoder reranker model')
        }
      })
      .catch((error) => {
        console.error('[useSearchModels] Failed to load reranker model:', error)
        setRerankerStatus('error')
        onLoadError(
          error instanceof Error ? error.message : 'Failed to load reranker model',
        )
      })

    Promise.allSettled([embeddingPromise, rerankerPromise]).then((results) => {
      const allOk = results.every((r) => r.status === 'fulfilled')
      // Only notify completion if neither callback already fired an error.
      const currentEmbedding = useAppStore.getState().embeddingStatus
      const currentReranker = useAppStore.getState().rerankerStatus
      if (allOk && currentEmbedding !== 'error' && currentReranker !== 'error') {
        onLoadEnd()
      }
    })
  }, [
    embeddingStatus,
    rerankerStatus,
    setEmbeddingStatus,
    setEmbeddingProgress,
    setRerankerStatus,
    setRerankerProgress,
  ])

  const combinedStatus = combineSearchModelsStatus(embeddingStatus, rerankerStatus)

  /** Retries loading both models from scratch (resets error state). */
  const retry = useCallback(() => {
    // Reset the reranker's internal load-failed flag so loadRerankerModel
    // attempts a fresh load instead of returning false immediately.
    resetRerankerLoadState()
    // Reset Zustand slices so the effect re-triggers.
    setEmbeddingStatus('idle')
    setEmbeddingProgress(0)
    setRerankerStatus('idle')
    setRerankerProgress(0)
    startedRef.current = false
  }, [setEmbeddingStatus, setEmbeddingProgress, setRerankerStatus, setRerankerProgress])

  return {
    embeddingStatus,
    rerankerStatus,
    combinedStatus,
    retry,
  }
}
