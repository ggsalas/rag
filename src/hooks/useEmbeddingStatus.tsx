import { useEffect } from 'react'
import { useAppStore } from '@/store/app.store'
import { initEmbeddingModel } from '@/services/embedding/embedding.service'

/** Callbacks to notify the consumer about embedding model loading lifecycle */
export interface EmbeddingLoadCallbacks {
  onLoadStart: () => void
  onLoadEnd: () => void
  onLoadError: (message: string) => void
}

/** Hook that initializes and tracks the embedding model loading status */
export function useEmbeddingStatus(callbacks: EmbeddingLoadCallbacks) {
  const embeddingStatus = useAppStore((s) => s.embeddingStatus)
  const setEmbeddingStatus = useAppStore((s) => s.setEmbeddingStatus)
  const setEmbeddingProgress = useAppStore((s) => s.setEmbeddingProgress)

  useEffect(() => {
    async function loadModel() {
      if (embeddingStatus !== 'idle') return
      setEmbeddingStatus('loading')
      setEmbeddingProgress(0)
      callbacks.onLoadStart()

      try {
        await initEmbeddingModel((progress) => setEmbeddingProgress(Math.round(progress * 100)))
        setEmbeddingStatus('ready')
        callbacks.onLoadEnd()
      } catch (error) {
        console.error('Failed to load embedding model:', error)
        setEmbeddingStatus('error')
        callbacks.onLoadError(error instanceof Error ? error.message : 'Failed to load embedding model')
      }
    }
    loadModel()
  }, [embeddingStatus, setEmbeddingStatus, setEmbeddingProgress])

  return { embeddingStatus }
}
