import { db } from '@/infrastructure/db'
import { generateId } from '@/lib/utils'
import type {
  DocumentMeta,
  DocumentStatus,
  DocumentContent,
} from '@/types/document'
import { removeByDocumentId } from '@/services/embedding/vector-store'

/** Creates a document record in the database for a library */
export async function createDocument(
  libraryId: string,
  file: { name: string; size: number; type: string },
): Promise<DocumentMeta> {
  const docType = inferDocumentType(file.type, file.name)
  if (!docType) {
    throw new Error(
      `Cannot create document: unsupported file type for "${file.name}"`,
    )
  }

  const now = Date.now()
  const document: DocumentMeta = {
    id: generateId(),
    libraryId,
    name: file.name,
    type: docType,
    size: file.size,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    chunkCount: 0,
  }

  await db.transaction('rw', db.documents, db.libraries, async () => {
    await db.documents.add(document)
    const library = await db.libraries.get(libraryId)
    if (library) {
      await db.libraries.update(libraryId, {
        documentCount: library.documentCount + 1,
        updatedAt: Date.now(),
      })
    }
  })

  return document
}

/** Retrieves all documents for a library, sorted by creation date descending */
export async function getDocumentsByLibrary(
  libraryId: string,
): Promise<DocumentMeta[]> {
  return db.documents
    .where('libraryId')
    .equals(libraryId)
    .reverse()
    .sortBy('createdAt')
}

/** Retrieves a single document by ID */
export async function getDocumentById(
  id: string,
): Promise<DocumentMeta | undefined> {
  return db.documents.get(id)
}

/** Updates the processing status of a document */
export async function updateDocumentStatus(
  id: string,
  status: DocumentStatus,
): Promise<void> {
  await db.documents.update(id, { status, updatedAt: Date.now() })
}

/** Deletes a document and all its associated chunks from database and vector index */
export async function deleteDocument(id: string): Promise<void> {
  const document = await db.documents.get(id)
  if (!document) return

  // Get chunks count before deletion for library update
  const chunks = await db.chunks.where('documentId').equals(id).toArray()
  const chunkCount = chunks.length

  await db.transaction(
    'rw',
    db.documents,
    db.libraries,
    db.chunks,
    db.documentContents,
    async () => {
      // Delete document
      await db.documents.delete(id)

      // Delete all associated chunks
      await db.chunks.where('documentId').equals(id).delete()

      // Delete document content
      await db.documentContents.delete(id)

      // Update library counts
      const library = await db.libraries.get(document.libraryId)
      if (library) {
        await db.libraries.update(document.libraryId, {
          documentCount: Math.max(0, library.documentCount - 1),
          chunkCount: Math.max(0, library.chunkCount - chunkCount),
          updatedAt: Date.now(),
        })
      }
    },
  )

  // Remove from vector index (not part of transaction, in-memory only)
  await removeByDocumentId(document.libraryId, id)
}

/**
 * Clean up documents that were interrupted during processing.
 * This happens when the browser is refreshed or closed while documents are being processed.
 *
 * After a page refresh, all Web Workers are terminated, so any document in 'pending' or 'parsing'
 * state (before document content is saved) is guaranteed to be stuck and will never complete.
 *
 * Documents in 'chunking' or 'embedding' state have their full text saved and could potentially
 * be re-processed, so they are not deleted by this cleanup.
 *
 * @returns The number of interrupted documents deleted
 */
export async function cleanupInterruptedDocuments(): Promise<number> {
  const interruptedDocs = await db.documents
    .filter((doc) => ['pending', 'parsing'].includes(doc.status))
    .toArray()

  if (interruptedDocs.length === 0) return 0

  // Delete each interrupted document (this will also clean up chunks and update library counts)
  for (const doc of interruptedDocs) {
    await deleteDocument(doc.id)
  }

  return interruptedDocs.length
}

/**
 * Infers document type from file extension (case-insensitive).
 * Returns null for unsupported types — callers must validate before creating
 * a document record.
 *
 * Validation is extension-based. MIME type is only used as a fallback for
 * extensionless files. Files with unsupported extensions (including DOC, DOCX,
 * CSV, etc.) return null regardless of MIME type.
 */
function inferDocumentType(
  mimeType: string,
  fileName: string,
): 'pdf' | 'txt' | 'md' | null {
  const lowerName = fileName.toLowerCase()

  // Check extension first (primary validation)
  if (lowerName.endsWith('.pdf')) return 'pdf'
  if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) return 'md'
  if (lowerName.endsWith('.txt')) return 'txt'

  // For extensionless files, fall back to MIME type
  const hasExtension = lowerName.includes('.')
  if (!hasExtension) {
    if (mimeType === 'application/pdf') return 'pdf'
    if (mimeType === 'text/markdown') return 'md'
    if (mimeType === 'text/plain') return 'txt'
  }

  return null
}

/** Saves the extracted text content of a document to the database */
export async function saveDocumentContent(
  content: DocumentContent,
): Promise<void> {
  await db.documentContents.put(content)
}

/** Retrieves the full text content of a document */
export async function getDocumentContent(
  documentId: string,
): Promise<DocumentContent | undefined> {
  return db.documentContents.get(documentId)
}
