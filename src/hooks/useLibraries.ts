import { useState, useEffect, useCallback } from 'react'
import type { Library } from '@/types/library'
import * as libraryService from '@/services/library.service'

/** Hook for managing all libraries with CRUD operations */
export function useLibraries() {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [loading, setLoading] = useState(true)

  const loadLibraries = useCallback(async () => {
    setLoading(true)
    try {
      const data = await libraryService.getAllLibraries()
      setLibraries(data)
    } catch (error) {
      console.error('Failed to load libraries:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadLibraries()
  }, [loadLibraries])

  const createLibrary = useCallback(
    async (name: string, description?: string) => {
      await libraryService.createLibrary(name, description)
      await loadLibraries()
    },
    [loadLibraries]
  )

  const deleteLibrary = useCallback(
    async (id: string) => {
      await libraryService.deleteLibrary(id)
      await loadLibraries()
    },
    [loadLibraries]
  )

  return {
    libraries,
    loading,
    createLibrary,
    deleteLibrary,
  }
}
