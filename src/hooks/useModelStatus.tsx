import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/app.store'
import { initModel } from '@/services/embedding/embedding.service'
import { ModelDownloadToast } from '@/components/search/ModelDownloadToast'

const TOAST_ID = 'model-status'

/** Hook that initializes and tracks the embedding model loading status */
export function useModelStatus() {
  const modelStatus = useAppStore((s) => s.modelStatus)
  const setModelStatus = useAppStore((s) => s.setModelStatus)
  const setModelProgress = useAppStore((s) => s.setModelProgress)

  useEffect(() => {
    async function loadModel() {
      if (modelStatus !== 'idle') return
      setModelStatus('loading')
      setModelProgress(0)
      // Live progress toast; its content subscribes to the store so it updates itself.
      toast(<ModelDownloadToast model="embedding" />, {
        id: TOAST_ID,
        duration: Infinity,
      })

      try {
        await initModel((progress) => setModelProgress(Math.round(progress * 100)))
        setModelStatus('ready')
        // Keep the SAME toast (now showing 100% / "Embedding model ready") and
        // dismiss it after a moment.
        setTimeout(() => toast.dismiss(TOAST_ID), 2000)
      } catch (error) {
        console.error('Failed to load embedding model:', error)
        setModelStatus('error')
        toast.error('Failed to load embedding model', {
          id: TOAST_ID,
          duration: Infinity,
          closeButton: true,
        })
      }
    }
    loadModel()
  }, [modelStatus, setModelStatus, setModelProgress])

  return { modelStatus }
}
