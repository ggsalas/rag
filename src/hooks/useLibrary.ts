import { useState, useEffect } from 'react'
import type { Library } from '@/types/library'
import * as libraryService from '@/services/library.service'

/** Hook for fetching a single library by ID */
export function useLibrary(libraryId: string) {
  const [library, setLibrary] = useState<Library | undefined>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadLibrary() {
      setLoading(true)
      try {
        const data = await libraryService.getLibraryById(libraryId)
        if (!cancelled) {
          setLibrary(data)
        }
      } catch (error) {
        console.error('Failed to load library:', error)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadLibrary()

    return () => {
      cancelled = true
    }
  }, [libraryId])

  return {
    library,
    loading,
  }
}
