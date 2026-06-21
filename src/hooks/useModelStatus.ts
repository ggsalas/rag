import { useEffect } from 'react'
import { useAppStore } from '@/store/app.store'
import { initModel } from '@/services/embedding/embedding.service'

/** Hook that initializes and tracks the embedding model loading status */
export function useModelStatus() {
  const modelStatus = useAppStore((s) => s.modelStatus)
  const setModelStatus = useAppStore((s) => s.setModelStatus)

  useEffect(() => {
    async function loadModel() {
      if (modelStatus !== 'idle') return
      setModelStatus('loading')
      try {
        await initModel()
        setModelStatus('ready')
      } catch (error) {
        console.error('Failed to load embedding model:', error)
        setModelStatus('error')
      }
    }
    loadModel()
  }, [modelStatus, setModelStatus])

  return { modelStatus }
}
