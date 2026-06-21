import { db } from '@/infrastructure/db'
import { generateId } from '@/lib/utils'
import type { Library } from '@/types/library'

/** Creates a new library in the database */
export async function createLibrary(
  name: string,
  description?: string,
): Promise<Library> {
  const now = Date.now()
  const library: Library = {
    id: generateId(),
    name,
    description,
    createdAt: now,
    updatedAt: now,
    documentCount: 0,
    chunkCount: 0,
  }
  await db.libraries.add(library)
  return library
}

/** Retrieves all libraries, sorted by creation date descending */
export async function getAllLibraries(): Promise<Library[]> {
  return db.libraries.orderBy('createdAt').reverse().toArray()
}

/** Retrieves a single library by ID */
export async function getLibraryById(id: string): Promise<Library | undefined> {
  return db.libraries.get(id)
}

/** Updates a library's name and/or description */
export async function updateLibrary(
  id: string,
  updates: Partial<Pick<Library, 'name' | 'description'>>,
): Promise<void> {
  await db.libraries.update(id, {
    ...updates,
    updatedAt: Date.now(),
  })
}

/** Deletes a library and all its associated documents */
export async function deleteLibrary(id: string): Promise<void> {
  await db.transaction('rw', db.libraries, db.documents, async () => {
    await db.documents.where('libraryId').equals(id).delete()
    await db.libraries.delete(id)
  })
}
