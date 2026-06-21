import Dexie, { type Table } from "dexie";
import type { Library } from "@/types/library";
import type { DocumentMeta, Chunk, DocumentContent } from "@/types/document";

/** Dexie database instance managing all persistent storage for TextAI */
export class TextAIDatabase extends Dexie {
  libraries!: Table<Library>;
  documents!: Table<DocumentMeta>;
  chunks!: Table<Chunk>;
  documentContents!: Table<DocumentContent>;

  constructor() {
    super("textai-db");
    this.version(1).stores({
      libraries: "id, name, createdAt",
      documents:
        "id, libraryId, name, status, createdAt, [libraryId+createdAt]",
      chunks: "id, libraryId, documentId, chunkIndex, [libraryId+documentId]",
      documentContents: "documentId, libraryId",
    });
  }
}

/** Global database instance */
export const db = new TextAIDatabase();
