import { db } from '@/infrastructure/db'
import { embedPassages } from '@/services/embedding/embedding.service'
import { insertChunks, removeIndex } from '@/services/embedding/vector-store'
import {
  chunkText,
  chunkMarkdown,
} from '@/services/ingest/chunking.service'
import { sanitize } from '@/services/ingest/sanitize.service'
import { extractMainContent } from '@/services/ingest/content-extractor.service'
import { generateId } from '@/lib/utils'
import type { Chunk } from '@/types/document'

export type ReindexProgressCallback = (
  current: number,
  total: number,
) => void | Promise<void>

/**
 * Rebuilds an entire library from its persisted document sources:
 *
 *   1. For each document, load its `DocumentContent.text` (post-sanitize).
 *   2. Re-run `extractMainContent` (may have new boilerplate rules since
 *      the last ingest).
 *   3. Re-chunk with the current chunker.
 *   4. Re-embed all chunks with the current embedding model.
 *   5. Replace chunks in Dexie and rebuild the Orama index.
 *
 * Use after any change to the pipeline that affects chunk content — new
 * embedding model, new content-extractor rules, new chunking strategy —
 * so existing libraries pick up the improvements without requiring the user
 * to re-upload files.
 *
 * Idempotent: safe to call multiple times.
 */
export async function reindexLibrary(
  libraryId: string,
  onProgress?: ReindexProgressCallback,
): Promise<{ reindexed: number }> {
  const documents = await db.documents
    .where('libraryId')
    .equals(libraryId)
    .toArray()

  if (documents.length === 0) return { reindexed: 0 }

  // Load DocumentContent for each doc and rebuild chunks by re-running the
  // full post-parse pipeline (sanitize → extractMainContent → chunk) on the
  // stored text. Sanitize is applied again in case its rules evolved since
  // the doc was originally ingested (e.g. new link-unwrapping visitor);
  // it is idempotent on already-clean input.
  const rebuiltChunks: Chunk[] = []
  for (const doc of documents) {
    const content = await db.documentContents.get(doc.id)
    if (!content || !content.text.trim()) continue

    const sanitized = sanitize(content.text)
    const extractedText = extractMainContent(sanitized)

    const isStructuredMarkdown =
      doc.type === 'pdf' ||
      doc.name.endsWith('.md') ||
      doc.name.endsWith('.markdown')

    const chunkDataList = isStructuredMarkdown
      ? chunkMarkdown(extractedText)
      : chunkText(extractedText)

    for (const data of chunkDataList) {
      rebuiltChunks.push({
        id: generateId(),
        libraryId,
        documentId: doc.id,
        documentName: doc.name,
        chunkIndex: data.chunkIndex,
        text: data.text,
        embedding: [], // filled in below
        headingText: data.headingText,
        sectionPath: data.sectionPath,
      })
    }

    // Persist the fully-processed text so the doc viewer shows what was indexed
    // and future reindexes start from an already-clean baseline.
    if (extractedText !== content.text) {
      await db.documentContents.put({ ...content, text: extractedText })
    }
  }

  if (rebuiltChunks.length === 0) return { reindexed: 0 }

  // Batch-embed all chunks across all documents in the library.
  const texts = rebuiltChunks.map((c) => c.text)
  const embeddings = await embedPassages(texts, onProgress)
  const withEmbeddings: Chunk[] = rebuiltChunks.map((c, i) => ({
    ...c,
    embedding: embeddings[i]!,
  }))

  // Atomic replace in Dexie: drop old chunks for this library, insert new ones.
  await db.transaction('rw', db.chunks, db.libraries, async () => {
    await db.chunks.where('libraryId').equals(libraryId).delete()
    await db.chunks.bulkAdd(withEmbeddings)
    await db.libraries.update(libraryId, {
      chunkCount: withEmbeddings.length,
      updatedAt: Date.now(),
    })
    // Per-document chunkCount too
    for (const doc of documents) {
      const count = withEmbeddings.filter((c) => c.documentId === doc.id).length
      await db.documents.update(doc.id, { chunkCount: count })
    }
  })

  // Rebuild Orama index from scratch with the fresh chunks.
  removeIndex(libraryId)
  await insertChunks(libraryId, withEmbeddings)

  return { reindexed: withEmbeddings.length }
}
