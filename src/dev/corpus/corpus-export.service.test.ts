import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/infrastructure/db'
import { createLibrary } from '@/services/library.service'
import { createDocument, saveDocumentContent } from '@/services/document.service'
import {
  exportLibraryCorpus,
  validateCorpusFixture,
} from './corpus-export.service'
import { generateId } from '@/lib/utils'
import type { Chunk } from '@/types/document'

beforeEach(async () => {
  await db.libraries.clear()
  await db.documents.clear()
  await db.chunks.clear()
  await db.documentContents.clear()
})

/** Helper: creates a chunk record with a deterministic embedding */
function makeChunk(
  libraryId: string,
  documentId: string,
  documentName: string,
  chunkIndex: number,
): Chunk {
  return {
    id: generateId(),
    libraryId,
    documentId,
    documentName,
    chunkIndex,
    text: `## Section ${chunkIndex}\n\nParagraph ${chunkIndex} content.`,
    searchText: `Section ${chunkIndex} Paragraph ${chunkIndex} content`,
    sectionPath: ['Root', `Section ${chunkIndex}`],
    headingText: `Section ${chunkIndex}`,
    embedding: Array.from({ length: 4 }, (_, i) => chunkIndex * 0.1 + i * 0.01),
  }
}

describe('corpus-export.service', () => {
  describe('exportLibraryCorpus', () => {
    it('should export a library with documents, content, and chunks', async () => {
      const library = await createLibrary('Test Library', 'A test library')
      const doc = await createDocument(library.id, {
        name: 'test.pdf',
        size: 2048,
        type: 'application/pdf',
      })

      await saveDocumentContent({
        documentId: doc.id,
        libraryId: library.id,
        text: '# Hello\n\nThis is the full filtered text.',
      })

      const chunk0 = makeChunk(library.id, doc.id, doc.name, 0)
      const chunk1 = makeChunk(library.id, doc.id, doc.name, 1)
      await db.chunks.bulkAdd([chunk0, chunk1])

      const fixture = await exportLibraryCorpus(library.id)

      // Library metadata
      expect(fixture.version).toBe(1)
      expect(fixture.library.id).toBe(library.id)
      expect(fixture.library.name).toBe('Test Library')
      expect(fixture.library.description).toBe('A test library')
      expect(fixture.exportedAt).toBeTruthy()

      // Documents
      expect(fixture.documents).toHaveLength(1)
      const fixtureDoc = fixture.documents[0]!
      expect(fixtureDoc.meta.id).toBe(doc.id)
      expect(fixtureDoc.meta.name).toBe('test.pdf')
      expect(fixtureDoc.content).toBe(
        '# Hello\n\nThis is the full filtered text.',
      )

      // Chunks
      expect(fixtureDoc.chunks).toHaveLength(2)
      expect(fixtureDoc.chunks[0]!.chunkIndex).toBe(0)
      expect(fixtureDoc.chunks[0]!.text).toContain('Section 0')
      expect(fixtureDoc.chunks[0]!.searchText).toContain('Section 0')
      expect(fixtureDoc.chunks[0]!.sectionPath).toEqual(['Root', 'Section 0'])
      expect(fixtureDoc.chunks[0]!.headingText).toBe('Section 0')
      expect(fixtureDoc.chunks[1]!.chunkIndex).toBe(1)

      // Embeddings (included by default)
      expect(fixture.embeddings).toHaveLength(2)
      expect(fixture.embeddings![0]!.documentId).toBe(doc.id)
      expect(fixture.embeddings![0]!.chunkIndex).toBe(0)
      expect(fixture.embeddings![0]!.embedding).toHaveLength(4)
    })

    it('should omit embeddings when includeEmbeddings is false', async () => {
      const library = await createLibrary('Lightweight')
      const doc = await createDocument(library.id, {
        name: 'doc.txt',
        size: 512,
        type: 'text/plain',
      })
      await saveDocumentContent({
        documentId: doc.id,
        libraryId: library.id,
        text: 'Some text.',
      })
      await db.chunks.add(makeChunk(library.id, doc.id, doc.name, 0))

      const fixture = await exportLibraryCorpus(library.id, {
        includeEmbeddings: false,
      })

      expect(fixture.embeddings).toBeUndefined()
      expect(fixture.documents[0]!.chunks).toHaveLength(1)
      expect(fixture.documents[0]!.content).toBe('Some text.')
    })

    it('should throw when library does not exist', async () => {
      await expect(
        exportLibraryCorpus('non-existent-id'),
      ).rejects.toThrow('Library not found')
    })

    it('should handle documents without saved content gracefully', async () => {
      const library = await createLibrary('No Content')
      await createDocument(library.id, {
        name: 'orphan.pdf',
        size: 100,
        type: 'application/pdf',
      })
      // No saveDocumentContent call — simulates a document that failed before
      // content was persisted.

      const fixture = await exportLibraryCorpus(library.id)

      expect(fixture.documents).toHaveLength(1)
      expect(fixture.documents[0]!.content).toBe('')
    })

    it('should be JSON-serializable and survive a round-trip', async () => {
      const library = await createLibrary('Round Trip')
      const doc = await createDocument(library.id, {
        name: 'rt.md',
        size: 300,
        type: 'text/plain',
      })
      await saveDocumentContent({
        documentId: doc.id,
        libraryId: library.id,
        text: '# Title\n\nBody text here.',
      })
      await db.chunks.add(makeChunk(library.id, doc.id, doc.name, 0))

      const fixture = await exportLibraryCorpus(library.id)
      const json = JSON.stringify(fixture)
      const parsed = JSON.parse(json)

      const error = validateCorpusFixture(parsed)
      expect(error).toBeNull()

      expect(parsed.documents).toHaveLength(1)
      expect(parsed.documents[0].content).toBe('# Title\n\nBody text here.')
      expect(parsed.embeddings).toHaveLength(1)
    })
  })

  describe('validateCorpusFixture', () => {
    it('should reject non-objects', () => {
      expect(validateCorpusFixture(null)).toBe('Fixture is not an object')
      expect(validateCorpusFixture('string')).toBe('Fixture is not an object')
    })

    it('should reject unsupported versions', () => {
      expect(validateCorpusFixture({ version: 99 })).toContain(
        'Unsupported fixture version',
      )
    })

    it('should reject missing required fields', () => {
      expect(validateCorpusFixture({ version: 1 })).toBe('Missing exportedAt')
      expect(validateCorpusFixture({ version: 1, exportedAt: 'x' })).toBe(
        'Missing library',
      )
      expect(
        validateCorpusFixture({ version: 1, exportedAt: 'x', library: {} }),
      ).toBe('Missing documents array')
    })

    it('should accept a valid minimal fixture', () => {
      const valid = {
        version: 1,
        exportedAt: '2026-01-01T00:00:00.000Z',
        library: {
          id: 'lib-1',
          name: 'Test',
          documentCount: 0,
          chunkCount: 0,
        },
        documents: [],
      }
      expect(validateCorpusFixture(valid)).toBeNull()
    })
  })
})
