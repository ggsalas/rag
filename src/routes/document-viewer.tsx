import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "react-router";
import {
  getDocumentContent,
  getDocumentById,
} from "@/services/document.service";
import { useChunkData } from "@/hooks/data/useChunkData";
import type { DocumentContent, DocumentMeta } from "@/types/document";

export function DocumentViewerPage() {
  const { libraryId, documentId } = useParams<{
    libraryId: string;
    documentId: string;
  }>();
  const [searchParams] = useSearchParams();
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [document, setDocument] = useState<DocumentMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const highlightRef = useRef<HTMLElement>(null);

  const highlightChunkIndex = searchParams.get("chunk")
    ? parseInt(searchParams.get("chunk")!, 10)
    : null;

  // Load chunk text for highlighting using data hook
  const { chunk } = useChunkData(libraryId, documentId, highlightChunkIndex);
  const chunkText = chunk?.text ?? null;

  useEffect(() => {
    async function loadDocument() {
      if (!documentId) return;

      setIsLoading(true);
      setError(null);

      try {
        const [docContent, docMeta] = await Promise.all([
          getDocumentContent(documentId),
          getDocumentById(documentId),
        ]);

        if (!docContent) {
          setError("Document content not found");
          return;
        }

        if (!docMeta) {
          setError("Document metadata not found");
          return;
        }

        setContent(docContent);
        setDocument(docMeta);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load document",
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadDocument();
  }, [documentId]);

  // Scroll to highlighted chunk after render
  useEffect(() => {
    if (!isLoading && highlightRef.current) {
      highlightRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [isLoading, chunkText]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading document...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  if (!content || !document) {
    return null;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="mb-6 pb-4 border-b border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {document.name}
          </h1>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span>Type: {document.type.toUpperCase()}</span>
            <span>•</span>
            <span>Size: {(document.size / 1024).toFixed(2)} KB</span>
            <span>•</span>
            <span>Chunks: {document.chunkCount}</span>
          </div>
        </div>

        <div className="prose max-w-none">
          <HighlightedText
            text={content.text}
            highlight={chunkText}
            highlightRef={highlightRef}
          />
        </div>
      </div>
    </div>
  );
}

interface HighlightedTextProps {
  text: string;
  highlight: string | null;
  highlightRef: React.RefObject<HTMLElement | null>;
}

function HighlightedText({
  text,
  highlight,
  highlightRef,
}: HighlightedTextProps) {
  if (!highlight) {
    return <div className="whitespace-pre-wrap text-gray-800">{text}</div>;
  }

  const match = findChunkInText(text, highlight);

  if (!match) {
    return <div className="whitespace-pre-wrap text-gray-800">{text}</div>;
  }

  const before = text.slice(0, match.start);
  const highlighted = text.slice(match.start, match.end);
  const after = text.slice(match.end);

  return (
    <div className="whitespace-pre-wrap text-gray-800">
      {before}
      <mark ref={highlightRef} className="bg-yellow-200 rounded px-0.5">
        {highlighted}
      </mark>
      {after}
    </div>
  );
}

/**
 * Build a mapping from a "spaceless" string back to original string indices.
 * Removes all whitespace chars, returns the stripped string and a map where
 * map[i] = the index in the original string of the i-th non-space character.
 */
function buildSpacelessMap(text: string): { stripped: string; map: number[] } {
  const map: number[] = [];
  let stripped = "";
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i]!)) {
      stripped += text[i];
      map.push(i);
    }
  }
  return { stripped, map };
}

function findChunkInText(
  fullText: string,
  chunkText: string,
): { start: number; end: number } | null {
  // 1. Try exact match first (fast path, works for txt/md/docx)
  const exactIndex = fullText.indexOf(chunkText);
  if (exactIndex !== -1) {
    return { start: exactIndex, end: exactIndex + chunkText.length };
  }

  // 2. Remove ALL whitespace from both and match on characters only.
  //    This handles cases where chunking inserts/removes spaces (e.g. around punctuation).
  const { stripped: strippedFull, map: fullMap } = buildSpacelessMap(fullText);
  const { stripped: strippedChunk } = buildSpacelessMap(chunkText);

  // Try full stripped chunk
  let idx = strippedFull.indexOf(strippedChunk);
  if (idx !== -1) {
    const start = fullMap[idx]!;
    const endIdx = idx + strippedChunk.length - 1;
    const end =
      endIdx < fullMap.length ? fullMap[endIdx]! + 1 : fullText.length;
    return { start, end };
  }

  // 3. If not found (overlap zone has text not in original), skip overlap
  const attempts = [150, 100, 60];
  for (const skip of attempts) {
    if (skip >= strippedChunk.length - 20) continue;
    const core = strippedChunk.slice(skip);
    if (core.length < 20) continue;

    idx = strippedFull.indexOf(core);
    if (idx !== -1) {
      const start = fullMap[Math.max(0, idx - skip)]!;
      const endIdx = idx + core.length - 1;
      const end =
        endIdx < fullMap.length ? fullMap[endIdx]! + 1 : fullText.length;
      return { start, end };
    }
  }

  return null;
}
