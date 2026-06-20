import { generateId } from "@/lib/utils";
import { parseFile } from "./parser.service";
import { chunkText, chunkTextWithPages } from "./chunking.service";
import { embedBatch } from "@/services/embedding/embedding.service";
import { insertChunks } from "@/services/embedding/vector-store";
import { db } from "@/services/db";
import {
  updateDocumentStatus,
  createDocument,
  saveDocumentContent,
} from "@/services/document.service";
import type { Chunk, DocumentMeta } from "@/types/document";
import { enqueue, waitForQueue } from "./ingest-queue";

const PROGRESS = {
  PARSING: [0, 10] as const,
  CHUNKING: [10, 15] as const,
  EMBEDDING: [15, 90] as const,
  INDEXING: [90, 100] as const,
};

function mapRange(
  value: number,
  total: number,
  range: readonly [number, number],
): number {
  if (total <= 0) return range[1];
  return Math.round(range[0] + (value / total) * (range[1] - range[0]));
}

async function updateProgress(documentId: string, progress: number): Promise<void> {
  await db.documents.update(documentId, { 
    processingProgress: progress,
    updatedAt: Date.now()
  });
}

async function processDocument(
  docMeta: DocumentMeta,
  file: File,
  libraryId: string,
): Promise<void> {
  try {
    await updateDocumentStatus(docMeta.id, "parsing");
    await updateProgress(docMeta.id, PROGRESS.PARSING[0]);

    const parseResult = await parseFile(file, async (current, total) => {
      await updateProgress(
        docMeta.id,
        mapRange(current, total, PROGRESS.PARSING),
      );
    });

    // Save document content
    await saveDocumentContent({
      documentId: docMeta.id,
      libraryId,
      text: parseResult.text,
      pages: parseResult.pages,
    });

    await updateDocumentStatus(docMeta.id, "chunking");
    await updateProgress(docMeta.id, PROGRESS.CHUNKING[0]);

    const chunkDataList = parseResult.pages
      ? chunkTextWithPages(parseResult.pages)
      : chunkText(parseResult.text);

    if (chunkDataList.length === 0) {
      throw new Error("No text could be extracted from document");
    }

    await updateDocumentStatus(docMeta.id, "embedding");
    await updateProgress(docMeta.id, PROGRESS.EMBEDDING[0]);

    const texts = chunkDataList.map((c) => c.text);
    const embeddings = await embedBatch(texts, async (current, total) => {
      await updateProgress(
        docMeta.id,
        mapRange(current, total, PROGRESS.EMBEDDING),
      );
    });

    const chunks: Chunk[] = chunkDataList.map((data, i) => ({
      id: generateId(),
      libraryId,
      documentId: docMeta.id,
      documentName: docMeta.name,
      chunkIndex: data.chunkIndex,
      text: data.text,
      embedding: embeddings[i]!,
      page: data.page,
    }));

    await updateProgress(docMeta.id, PROGRESS.INDEXING[0]);
    await db.chunks.bulkAdd(chunks);

    await insertChunks(libraryId, chunks);

    await db.documents.update(docMeta.id, { 
      chunkCount: chunks.length, 
      processingProgress: undefined 
    });
    await db.libraries
      .where("id")
      .equals(libraryId)
      .modify((lib) => {
        lib.chunkCount = (lib.chunkCount || 0) + chunks.length;
      });

    await updateDocumentStatus(docMeta.id, "indexed");
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    await db.documents.update(docMeta.id, { 
      status: "error", 
      error: errMsg,
      processingProgress: undefined 
    });
  }
}

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
  );

  for (let i = 0; i < files.length; i++) {
    enqueue(() => processDocument(docMetas[i]!, files[i]!, libraryId));
  }

  await waitForQueue();
}
