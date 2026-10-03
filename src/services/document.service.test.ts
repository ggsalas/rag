import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/infrastructure/db'
import { createLibrary } from './library.service'
import {
  createDocument,
  getDocumentsByLibrary,
  getDocumentById,
  updateDocumentStatus,
  deleteDocument,
} from './document.service'

beforeEach(async () => {
  await db.libraries.clear()
  await db.documents.clear()
})

describe('document.service', () => {
  describe('createDocument', () => {
    it('should create a document with required fields', async () => {
      const library = await createLibrary('My Library')

      const document = await createDocument(library.id, {
        name: 'test.pdf',
        size: 1000,
        type: 'application/pdf',
      })

      expect(document.id).toBeTruthy()
      expect(document.libraryId).toBe(library.id)
      expect(document.name).toBe('test.pdf')
      expect(document.type).toBe('pdf')
      expect(document.size).toBe(1000)
      expect(document.createdAt).toBeGreaterThan(0)
      expect(document.status).toBe('pending')
      expect(document.chunkCount).toBe(0)
    })

    it('should increment library documentCount', async () => {
      const library = await createLibrary('My Library')

      await createDocument(library.id, {
        name: 'test.pdf',
        size: 1000,
        type: 'application/pdf',
      })

      const updatedLibrary = await db.libraries.get(library.id)
      expect(updatedLibrary?.documentCount).toBe(1)
    })

    it('should infer document type from mime type', async () => {
      const library = await createLibrary('My Library')

      const pdf = await createDocument(library.id, {
        name: 'doc.pdf',
        size: 1000,
        type: 'application/pdf',
      })
      expect(pdf.type).toBe('pdf')

      const txt = await createDocument(library.id, {
        name: 'doc.txt',
        size: 1000,
        type: 'text/plain',
      })
      expect(txt.type).toBe('txt')
    })

    it('should reject unsupported file types', async () => {
      const library = await createLibrary('My Library')

      // DOCX is unsupported
      await expect(
        createDocument(library.id, {
          name: 'doc.docx',
          size: 1000,
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ).rejects.toThrow('unsupported file type')

      // Unknown extension
      await expect(
        createDocument(library.id, {
          name: 'doc.xyz',
          size: 1000,
          type: 'application/octet-stream',
        }),
      ).rejects.toThrow('unsupported file type')
    })

    it('should not create document row when rejection happens', async () => {
      const library = await createLibrary('My Library')

      // Try to create a DOCX document (should be rejected)
      await expect(
        createDocument(library.id, {
          name: 'doc.docx',
          size: 1000,
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ).rejects.toThrow()

      // Verify no document was created in the database
      const docs = await getDocumentsByLibrary(library.id)
      expect(docs).toHaveLength(0)

      // Verify library documentCount was not incremented
      const updatedLibrary = await db.libraries.get(library.id)
      expect(updatedLibrary?.documentCount).toBe(0)
    })

    it('should reject .docx even with text/plain MIME type', async () => {
      const library = await createLibrary('My Library')

      // .docx with text/plain MIME should still be rejected (extension-based validation)
      await expect(
        createDocument(library.id, {
          name: 'report.docx',
          size: 1000,
          type: 'text/plain',
        }),
      ).rejects.toThrow('unsupported file type')

      // Verify no document was created
      const docs = await getDocumentsByLibrary(library.id)
      expect(docs).toHaveLength(0)
    })

    it('should reject .csv even with text/plain MIME type', async () => {
      const library = await createLibrary('My Library')

      // .csv with text/plain MIME should be rejected (extension-based validation)
      await expect(
        createDocument(library.id, {
          name: 'data.csv',
          size: 1000,
          type: 'text/plain',
        }),
      ).rejects.toThrow('unsupported file type')

      // Verify no document was created
      const docs = await getDocumentsByLibrary(library.id)
      expect(docs).toHaveLength(0)
    })

    it('should handle case-insensitive file extensions', async () => {
      const library = await createLibrary('My Library')

      const pdfUpper = await createDocument(library.id, {
        name: 'DOC.PDF',
        size: 1000,
        type: '',
      })
      expect(pdfUpper.type).toBe('pdf')

      const mdUpper = await createDocument(library.id, {
        name: 'README.MD',
        size: 1000,
        type: '',
      })
      expect(mdUpper.type).toBe('md')

      const txtUpper = await createDocument(library.id, {
        name: 'NOTES.TXT',
        size: 1000,
        type: '',
      })
      expect(txtUpper.type).toBe('txt')
    })

    it('should infer document type from file extension', async () => {
      const library = await createLibrary('My Library')

      const md = await createDocument(library.id, {
        name: 'doc.md',
        size: 1000,
        type: '',
      })
      expect(md.type).toBe('md')
    })
  })

  describe('getDocumentsByLibrary', () => {
    it('should return empty array when no documents', async () => {
      const library = await createLibrary('My Library')
      const documents = await getDocumentsByLibrary(library.id)

      expect(documents).toEqual([])
    })

    it('should return documents for specific library', async () => {
      const lib1 = await createLibrary('Library 1')
      const lib2 = await createLibrary('Library 2')

      const doc1 = await createDocument(lib1.id, {
        name: 'doc1.pdf',
        size: 1000,
        type: 'application/pdf',
      })
      await createDocument(lib2.id, {
        name: 'doc2.pdf',
        size: 1000,
        type: 'application/pdf',
      })

      const documents = await getDocumentsByLibrary(lib1.id)

      expect(documents).toHaveLength(1)
      expect(documents[0]!.id).toBe(doc1.id)
    })

    it('should return documents ordered by createdAt desc', async () => {
      const library = await createLibrary('My Library')

      const doc1 = await createDocument(library.id, {
        name: 'first.pdf',
        size: 1000,
        type: 'application/pdf',
      })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const doc2 = await createDocument(library.id, {
        name: 'second.pdf',
        size: 1000,
        type: 'application/pdf',
      })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const doc3 = await createDocument(library.id, {
        name: 'third.pdf',
        size: 1000,
        type: 'application/pdf',
      })

      const documents = await getDocumentsByLibrary(library.id)

      expect(documents).toHaveLength(3)
      expect(documents[0]!.id).toBe(doc3.id)
      expect(documents[1]!.id).toBe(doc2.id)
      expect(documents[2]!.id).toBe(doc1.id)
    })
  })

  describe('getDocumentById', () => {
    it('should return document by id', async () => {
      const library = await createLibrary('My Library')
      const document = await createDocument(library.id, {
        name: 'test.pdf',
        size: 1000,
        type: 'application/pdf',
      })

      const retrieved = await getDocumentById(document.id)

      expect(retrieved).toEqual(document)
    })

    it('should return undefined for non-existent id', async () => {
      const retrieved = await getDocumentById('non-existent')
      expect(retrieved).toBeUndefined()
    })
  })

  describe('updateDocumentStatus', () => {
    it('should update document status', async () => {
      const library = await createLibrary('My Library')
      const document = await createDocument(library.id, {
        name: 'test.pdf',
        size: 1000,
        type: 'application/pdf',
      })

      await updateDocumentStatus(document.id, 'parsing')

      const updated = await getDocumentById(document.id)
      expect(updated?.status).toBe('parsing')
    })
  })

  describe('deleteDocument', () => {
    it('should delete document', async () => {
      const library = await createLibrary('My Library')
      const document = await createDocument(library.id, {
        name: 'test.pdf',
        size: 1000,
        type: 'application/pdf',
      })

      await deleteDocument(document.id)

      const retrieved = await getDocumentById(document.id)
      expect(retrieved).toBeUndefined()
    })

    it('should decrement library documentCount', async () => {
      const library = await createLibrary('My Library')
      const document = await createDocument(library.id, {
        name: 'test.pdf',
        size: 1000,
        type: 'application/pdf',
      })

      await deleteDocument(document.id)

      const updatedLibrary = await db.libraries.get(library.id)
      expect(updatedLibrary?.documentCount).toBe(0)
    })

    it('should handle deleting non-existent document', async () => {
      await expect(deleteDocument('non-existent')).resolves.not.toThrow()
    })
  })
})
