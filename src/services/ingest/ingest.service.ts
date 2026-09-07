import { generateId } from '@/lib/utils'
import { parseFile } from './parser.service'
import { chunkText, chunkMarkdown } from './chunking.service'
import { sanitize } from './sanitize.service'
import { filterMalformedLayoutBlocks } from './malformed-layout-filter.service'
import { filterBoilerplateSections } from './section-filter.service'
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
 * Processes a document through the complete ingestion pipeline:
 * parsing → chunking → embedding → indexing.
 * Updates status and progress at each stage.
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

    // Sanitize before chunking to strip nav chrome, escape sequences, orphan URLs, etc.
    const cleanText = sanitize(parseResult.text)

    // Filter boilerplate sections (References, Bibliography, etc.)
    // Only applied to structured Markdown (PDF/MD), not plain text
    const isStructuredMarkdown =
      docMeta.type === 'pdf' ||
      docMeta.name.endsWith('.md') ||
      docMeta.name.endsWith('.markdown')

    // Enable conservative heuristic for unknown boilerplate-like sections
    // Named section filter (References, Bibliography, etc.) is the primary filter
    //
    // For structured Markdown, first drop malformed layout/sidebar blocks
    // (consecutive heading runs + link-heavy/sidebar content emitted by
    // LiteParse from Wikipedia-style infoboxes). Runs before the named
    // boilerplate filter so sidebar noise doesn't leak into chunking.
    const filteredText = isStructuredMarkdown
      ? filterBoilerplateSections(filterMalformedLayoutBlocks(cleanText), {
          enableHeuristic: true,
        })
      : cleanText

    await saveDocumentContent({
      documentId: docMeta.id,
      libraryId,
      text: filteredText,
    })

    await updateDocumentStatus(docMeta.id, 'chunking')
    await updateProgress(docMeta.id, PROGRESS.CHUNKING[0])

    // PDFs return structured markdown from LiteParse, so they take the same
    // markdown path as native .md files. Plain-text formats use paragraph chunking.
    const chunkDataList = isStructuredMarkdown
      ? chunkMarkdown(filteredText)
      : chunkText(filteredText)

    if (chunkDataList.length === 0) {
      throw new Error('No text could be extracted from document')
    }

    await updateDocumentStatus(docMeta.id, 'embedding')
    await updateProgress(docMeta.id, PROGRESS.EMBEDDING[0])

    // Build embedding text from section context + searchText
    // This provides better semantic context for the embedding model
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
 * Creates document records and queues them for concurrent processing.
 */
export async function ingestDocuments(
  files: File[],
  libraryId: string,
): Promise<void> {
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
