import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@/store/app.store'
import {
  loadCrossEncoderModel,
  resetCrossEncoderLoadState,
} from '@/services/search/cross-encoder.service'
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

/** Callbacks to notify the consumer about cross-encoder loading lifecycle */
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
  crossEncoderStatus: 'idle' | 'loading' | 'ready' | 'error',
): SearchModelsStatus {
  if (embeddingStatus === 'ready' && crossEncoderStatus === 'ready') return 'ready'
  if (embeddingStatus === 'error' || crossEncoderStatus === 'error') return 'error'
  if (embeddingStatus === 'loading' || crossEncoderStatus === 'loading') return 'loading'
  // Both idle, or one idle + other not yet loading
  if (embeddingStatus === 'idle' && crossEncoderStatus === 'idle') return 'idle'
  // Mixed idle/loading → still loading
  return 'loading'
}

/**
 * Loads and tracks the cross-encoder model, while observing the embedding
 * model status owned by App/useEmbeddingStatus.
 *
 * Search is enabled only when BOTH models are `ready`. The hook never calls
 * `initEmbeddingModel` — that responsibility belongs to App/useEmbeddingStatus.
 *
 * The hook is idempotent: re-renders or StrictMode re-runs do not restart an
 * already-running cross-encoder load.
 */
export function useSearchModels(callbacks: SearchModelsCallbacks) {
  const embeddingStatus = useAppStore((s) => s.embeddingStatus)
  const setEmbeddingStatus = useAppStore((s) => s.setEmbeddingStatus)
  const setEmbeddingProgress = useAppStore((s) => s.setEmbeddingProgress)
  const crossEncoderStatus = useAppStore((s) => s.crossEncoderStatus)
  const setCrossEncoderStatus = useAppStore((s) => s.setCrossEncoderStatus)
  const setCrossEncoderProgress = useAppStore((s) => s.setCrossEncoderProgress)

  // Stable ref for callbacks so the effect doesn't re-run on every render.
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  // Prevents duplicate cross-encoder starts when the effect re-runs
  // (e.g. React StrictMode or status transitions).
  const crossEncoderStartedRef = useRef(false)

  // Start the cross-encoder when its status is `idle` and it hasn't already
  // been initiated in this load cycle. Embedding status is only observed.
  useEffect(() => {
    if (crossEncoderStatus !== 'idle' || crossEncoderStartedRef.current) return

    const { onLoadStart, onLoadError } = callbacksRef.current

    // Mark ref BEFORE starting async work so re-runs won't re-initiate.
    crossEncoderStartedRef.current = true

    onLoadStart()

    setCrossEncoderStatus('loading')
    setCrossEncoderProgress(0)
    const progressCallback: RerankerLoadProgressCallback = (progress) =>
      setCrossEncoderProgress(Math.round(progress * 100))
    loadCrossEncoderModel(progressCallback)
      .then(() => setCrossEncoderStatus('ready'))
      .catch((error) => {
        console.error('[useSearchModels] Failed to load cross-encoder model:', error)
        setCrossEncoderStatus('error')
        onLoadError(
          error instanceof Error ? error.message : 'Failed to load cross-encoder model',
        )
      })
  }, [crossEncoderStatus, setCrossEncoderStatus, setCrossEncoderProgress])

  // Notify onLoadEnd once both models reach `ready`.
  useEffect(() => {
    if (embeddingStatus === 'ready' && crossEncoderStatus === 'ready') {
      callbacksRef.current.onLoadEnd()
    }
  }, [embeddingStatus, crossEncoderStatus])

  const combinedStatus = combineSearchModelsStatus(embeddingStatus, crossEncoderStatus)

  /**
   * Retries loading failed models.
   * Always resets the cross-encoder and its state/progress.
   * If embedding is in error, resets it to idle so App/useEmbeddingStatus
   * (the owner) re-attempts the load. If embedding is ready/loading, leaves it.
   */
  const retry = useCallback(() => {
    // Always reset cross-encoder
    resetCrossEncoderLoadState()
    crossEncoderStartedRef.current = false
    setCrossEncoderStatus('idle')
    setCrossEncoderProgress(0)

    // Only reset embedding if it failed — App/useEmbeddingStatus owns it
    if (embeddingStatus === 'error') {
      setEmbeddingStatus('idle')
      setEmbeddingProgress(0)
    }
  }, [
    embeddingStatus,
    setEmbeddingStatus,
    setEmbeddingProgress,
    setCrossEncoderStatus,
    setCrossEncoderProgress,
  ])

  return {
    embeddingStatus,
    crossEncoderStatus,
    combinedStatus,
    retry,
  }
}
