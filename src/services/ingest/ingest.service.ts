import { generateId } from '@/lib/utils'
import {
  parseFile,
  isSupportedFile,
  UnsupportedFileTypeError,
} from './source/parse-file.service'
import { chunkMarkdown } from './chunking.service'
import { chunkPlainText } from './text/text-chunker.service'
import { normalizeMarkdown } from './markdown/normalize-markdown.service'
import { normalizeText } from './text/normalize-text.service'
import { embedBatch } from '@/services/embedding/embedding.service'
import { insertChunks } from '@/services/embedding/vector-store'
import { db } from '@/infrastructure/db'
import {
  updateDocumentStatus,
  createDocument,
  saveDocumentContent,
} from '@/services/document.service'
import type { Chunk, DocumentMeta } from '@/types/document'
import { enqueue, waitForQueue } from './ingest-queue'

const PROGRESS = {
  PARSING: [0, 10] as const,
  CHUNKING: [10, 15] as const,
  EMBEDDING: [15, 90] as const,
  INDEXING: [90, 100] as const,
}

/** Maps progress value to a percentage range */
function mapRange(
  value: number,
  total: number,
  range: readonly [number, number],
): number {
  if (total <= 0) return range[1]
  return Math.round(range[0] + (value / total) * (range[1] - range[0]))
}

/** Updates document processing progress in the database */
async function updateProgress(
  documentId: string,
  progress: number,
): Promise<void> {
  await db.documents.update(documentId, {
    processingProgress: progress,
    updatedAt: Date.now(),
  })
}

/**
 * Processes a document through the complete ingestion pipeline.
 *
 * Flow:
 *   1. Parse source file → ParsedContent (format: 'markdown' | 'text')
 *   2. Normalize through the format-specific route:
 *      - markdown: sanitize → filter → flatten inline markup
 *      - text: whitespace normalization only
 *   3. Save normalized body to documentContents
 *   4. Chunk with format-specific chunker
 *   5. Embed → persist → index
 *
 * Status/progress/error handling wraps the whole pipeline.
 */
async function processDocument(
  docMeta: DocumentMeta,
  file: File,
  libraryId: string,
): Promise<void> {
  try {
    await updateDocumentStatus(docMeta.id, 'parsing')
    await updateProgress(docMeta.id, PROGRESS.PARSING[0])

    const parseResult = await parseFile(file, async (current, total) => {
      await updateProgress(
        docMeta.id,
        mapRange(current, total, PROGRESS.PARSING),
      )
    })

    await updateDocumentStatus(docMeta.id, 'chunking')
    await updateProgress(docMeta.id, PROGRESS.CHUNKING[0])

    // Normalize through the format-specific route
    const normalizedBody =
      parseResult.format === 'markdown'
        ? normalizeMarkdown(parseResult.text)
        : normalizeText(parseResult.text)

    // Save the normalized body as the document content (viewer shows this)
    await saveDocumentContent({
      documentId: docMeta.id,
      libraryId,
      text: normalizedBody,
    })

    // Chunk with format-specific chunker
    const chunkDataList =
      parseResult.format === 'markdown'
        ? chunkMarkdown(normalizedBody)
        : chunkPlainText(normalizedBody)

    if (chunkDataList.length === 0) {
      throw new Error('No text could be extracted from document')
    }

    await updateDocumentStatus(docMeta.id, 'embedding')
    await updateProgress(docMeta.id, PROGRESS.EMBEDDING[0])

    // Build embedding text from section context + searchText
    const texts = chunkDataList.map((c) => buildEmbeddingText(c))
    const embeddings = await embedBatch(texts, async (current, total) => {
      await updateProgress(
        docMeta.id,
        mapRange(current, total, PROGRESS.EMBEDDING),
      )
    })

    const chunks: Chunk[] = chunkDataList.map((data, i) => ({
      id: generateId(),
      libraryId,
      documentId: docMeta.id,
      documentName: docMeta.name,
      chunkIndex: data.chunkIndex,
      text: data.text,
      searchText: data.searchText,
      sectionPath: data.sectionPath,
      headingText: data.headingText,
      sourceStart: data.sourceStart,
      sourceEnd: data.sourceEnd,
      embedding: embeddings[i]!,
    }))

    await updateProgress(docMeta.id, PROGRESS.INDEXING[0])
    await db.chunks.bulkAdd(chunks)

    await insertChunks(libraryId, chunks)

    // Update document and library with final chunk counts
    await db.documents.update(docMeta.id, {
      chunkCount: chunks.length,
      processingProgress: undefined,
    })
    await db.libraries
      .where('id')
      .equals(libraryId)
      .modify((lib) => {
        lib.chunkCount = (lib.chunkCount || 0) + chunks.length
      })

    await updateDocumentStatus(docMeta.id, 'indexed')
  } catch (error) {
    // Mark document as error and clear progress
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    await db.documents.update(docMeta.id, {
      status: 'error',
      error: errMsg,
      processingProgress: undefined,
    })
  }
}

/**
 * Ingests multiple files into a library.
 * Validates file types before creating document records.
 * Throws UnsupportedFileTypeError if any file is unsupported.
 */
export async function ingestDocuments(
  files: File[],
  libraryId: string,
): Promise<void> {
  // Validate all files before creating any document records
  const unsupported = files.filter((file) => !isSupportedFile(file))
  if (unsupported.length > 0) {
    const names = unsupported.map((f) => f.name).join(', ')
    throw new UnsupportedFileTypeError(names)
  }

  const docMetas = await Promise.all(
    files.map((file) =>
      createDocument(libraryId, {
        name: file.name,
        size: file.size,
        type: file.type,
      }),
    ),
  )

  for (let i = 0; i < files.length; i++) {
    enqueue(() => processDocument(docMetas[i]!, files[i]!, libraryId))
  }

  await waitForQueue()
}

/**
 * Builds the text to embed for a chunk.
 * Combines section context (heading path) with searchText for better semantic retrieval.
 */
function buildEmbeddingText(chunk: {
  searchText: string
  sectionPath: string[]
  headingText: string
}): string {
  const parts: string[] = []

  // Add section context (heading hierarchy)
  if (chunk.sectionPath.length > 0) {
    parts.push(chunk.sectionPath.join(' > '))
  }

  // Add the plain text content
  parts.push(chunk.searchText)

  return parts.join('\n')
}
