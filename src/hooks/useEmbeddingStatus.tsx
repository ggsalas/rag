import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/app.store'
import { initEmbeddingModel } from '@/services/embedding/embedding.service'
import { ModelDownloadToast } from '@/components/search/ModelDownloadToast'

const TOAST_ID = 'model-status'

/** Hook that initializes and tracks the embedding model loading status */
export function useEmbeddingStatus() {
  const embeddingStatus = useAppStore((s) => s.embeddingStatus)
  const setEmbeddingStatus = useAppStore((s) => s.setEmbeddingStatus)
  const setEmbeddingProgress = useAppStore((s) => s.setEmbeddingProgress)

  useEffect(() => {
    async function loadModel() {
      if (embeddingStatus !== 'idle') return
      setEmbeddingStatus('loading')
      setEmbeddingProgress(0)
      // Live progress toast; its content subscribes to the store so it updates itself.
      toast(<ModelDownloadToast model="embedding" />, {
        id: TOAST_ID,
        duration: Infinity,
      })

      try {
        await initEmbeddingModel((progress) => setEmbeddingProgress(Math.round(progress * 100)))
        setEmbeddingStatus('ready')
        // Keep the SAME toast (now showing 100% / "Embedding model ready") and
        // dismiss it after a moment.
        setTimeout(() => toast.dismiss(TOAST_ID), 2000)
      } catch (error) {
        console.error('Failed to load embedding model:', error)
        setEmbeddingStatus('error')
        toast.error('Failed to load embedding model', {
          id: TOAST_ID,
          duration: Infinity,
          closeButton: true,
        })
      }
    }
    loadModel()
  }, [embeddingStatus, setEmbeddingStatus, setEmbeddingProgress])

  return { embeddingStatus }
}
