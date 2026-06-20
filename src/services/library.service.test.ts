import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'
import {
  createLibrary,
  getAllLibraries,
  getLibraryById,
  updateLibrary,
  deleteLibrary,
} from './library.service'

beforeEach(async () => {
  await db.libraries.clear()
  await db.documents.clear()
})

describe('library.service', () => {
  describe('createLibrary', () => {
    it('should create a library with required fields', async () => {
      const library = await createLibrary('My Library')
      
      expect(library.id).toBeTruthy()
      expect(library.name).toBe('My Library')
      expect(library.description).toBeUndefined()
      expect(library.createdAt).toBeGreaterThan(0)
      expect(library.updatedAt).toBe(library.createdAt)
      expect(library.documentCount).toBe(0)
      expect(library.chunkCount).toBe(0)
    })

    it('should create a library with description', async () => {
      const library = await createLibrary('My Library', 'Test description')
      
      expect(library.description).toBe('Test description')
    })

    it('should persist library to database', async () => {
      const library = await createLibrary('My Library')
      const retrieved = await db.libraries.get(library.id)
      
      expect(retrieved).toEqual(library)
    })
  })

  describe('getAllLibraries', () => {
    it('should return empty array when no libraries', async () => {
      const libraries = await getAllLibraries()
      expect(libraries).toEqual([])
    })

    it('should return all libraries ordered by createdAt desc', async () => {
      const lib1 = await createLibrary('First')
      await new Promise(resolve => setTimeout(resolve, 10))
      const lib2 = await createLibrary('Second')
      await new Promise(resolve => setTimeout(resolve, 10))
      const lib3 = await createLibrary('Third')
      
      const libraries = await getAllLibraries()
      
      expect(libraries).toHaveLength(3)
      expect(libraries[0]!.id).toBe(lib3.id)
      expect(libraries[1]!.id).toBe(lib2.id)
      expect(libraries[2]!.id).toBe(lib1.id)
    })
  })

  describe('getLibraryById', () => {
    it('should return library by id', async () => {
      const library = await createLibrary('My Library')
      const retrieved = await getLibraryById(library.id)
      
      expect(retrieved).toEqual(library)
    })

    it('should return undefined for non-existent id', async () => {
      const retrieved = await getLibraryById('non-existent')
      expect(retrieved).toBeUndefined()
    })
  })

  describe('updateLibrary', () => {
    it('should update library name', async () => {
      const library = await createLibrary('Original Name')
      
      await new Promise(resolve => setTimeout(resolve, 10))
      await updateLibrary(library.id, { name: 'Updated Name' })
      
      const updated = await getLibraryById(library.id)
      expect(updated?.name).toBe('Updated Name')
      expect(updated?.updatedAt).toBeGreaterThan(library.updatedAt)
    })

    it('should update library description', async () => {
      const library = await createLibrary('My Library')
      
      await updateLibrary(library.id, { description: 'New description' })
      
      const updated = await getLibraryById(library.id)
      expect(updated?.description).toBe('New description')
    })

    it('should update both name and description', async () => {
      const library = await createLibrary('My Library')
      
      await updateLibrary(library.id, {
        name: 'New Name',
        description: 'New description',
      })
      
      const updated = await getLibraryById(library.id)
      expect(updated?.name).toBe('New Name')
      expect(updated?.description).toBe('New description')
    })
  })

  describe('deleteLibrary', () => {
    it('should delete library', async () => {
      const library = await createLibrary('My Library')
      
      await deleteLibrary(library.id)
      
      const retrieved = await getLibraryById(library.id)
      expect(retrieved).toBeUndefined()
    })

    it('should cascade delete documents in library', async () => {
      const library = await createLibrary('My Library')
      
      const now = Date.now()
      await db.documents.add({
        id: 'doc1',
        libraryId: library.id,
        name: 'test.pdf',
        type: 'pdf',
        size: 1000,
        createdAt: now,
        updatedAt: now,
        status: 'pending',
        chunkCount: 0,
      })
      
      await deleteLibrary(library.id)
      
      const documents = await db.documents.where('libraryId').equals(library.id).toArray()
      expect(documents).toHaveLength(0)
    })
  })
})
