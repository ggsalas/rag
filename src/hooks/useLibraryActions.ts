import { useCallback } from 'react'
import * as libraryService from '@/services/library.service'

/** Hook for library write operations (create, rename, delete) */
export function useLibraryActions() {
  const createLibrary = useCallback(async (name: string) => {
    return libraryService.createLibrary(name)
  }, [])

  const renameLibrary = useCallback(async (id: string, name: string) => {
    await libraryService.updateLibrary(id, { name })
  }, [])

  const deleteLibrary = useCallback(async (id: string) => {
    await libraryService.deleteLibrary(id)
  }, [])

  return { createLibrary, renameLibrary, deleteLibrary }
}
