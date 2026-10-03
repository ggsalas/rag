import type { BenchmarkCase } from './search-benchmark.types'
import { anchorMatch } from './search-benchmark.evaluation'

/**
 * Corpus coverage diagnostic: scans all chunks in a library to determine
 * whether benchmark anchors are present in the indexed content.
 *
 * This distinguishes two failure modes:
 * - **Corpus/chunking issue**: anchor is absent from all chunks → the content
 *   was never ingested, or chunking split it across boundaries.
 * - **Retrieval/ranking issue**: anchor is present but not surfaced in top-k
 *   results → search or reranking needs tuning.
 *
 * Matching semantics mirror the benchmark evaluator: case-insensitive substring
 * match against both `text` and `searchText`.
 */

/** Minimal chunk shape required for corpus scanning */
export type CorpusChunk = {
  chunkId: string
  /** Chunk index within the document (for display) */
  chunkIndex: number
  /** Document name (for context) */
  documentName: string
  /** Sanitized Markdown text */
  text: string
  /** Plain text used for retrieval */
  searchText: string
}

/** Per-anchor match result */
export type AnchorCoverage = {
  anchor: string
  /** Whether the anchor was found in any chunk */
  found: boolean
  /** Indices of chunks containing the anchor (empty if not found) */
  matchingChunkIndices: number[]
  /** IDs of chunks containing the anchor (empty if not found) */
  matchingChunkIds: string[]
}

/** Per-case coverage result */
export type CaseCoverage = {
  caseId: string
  /** Coverage for each required anchor */
  requiredAnchors: AnchorCoverage[]
  /** Coverage for each supporting anchor */
  supportingAnchors: AnchorCoverage[]
  /** Total number of chunks scanned */
  totalChunks: number
}

/**
 * Scans all chunks to determine which benchmark anchors are present.
 *
 * Returns per-case coverage showing which anchors exist in the corpus and
 * which chunks contain them. This is a diagnostic tool to distinguish corpus
 * issues (anchor absent) from retrieval issues (anchor present but not ranked).
 */
export function scanCorpusCoverage(
  chunks: CorpusChunk[],
  cases: BenchmarkCase[],
): CaseCoverage[] {
  return cases.map((case_) => {
    const requiredAnchors = case_.requiredAnchors.map((anchor) =>
      scanAnchor(chunks, anchor),
    )
    const supportingAnchors = case_.supportingAnchors.map((anchor) =>
      scanAnchor(chunks, anchor),
    )

    return {
      caseId: case_.id,
      requiredAnchors,
      supportingAnchors,
      totalChunks: chunks.length,
    }
  })
}

/** Scans all chunks for a single anchor, returning match details */
function scanAnchor(chunks: CorpusChunk[], anchor: string): AnchorCoverage {
  const matchingChunkIndices: number[] = []
  const matchingChunkIds: string[] = []

  for (const chunk of chunks) {
    // Reuse the evaluator's anchorMatch for consistent semantics
    const benchmarkChunk = {
      chunkId: chunk.chunkId,
      text: chunk.text,
      searchText: chunk.searchText,
    }
    if (anchorMatch(benchmarkChunk, anchor)) {
      matchingChunkIndices.push(chunk.chunkIndex)
      matchingChunkIds.push(chunk.chunkId)
    }
  }

  return {
    anchor,
    found: matchingChunkIndices.length > 0,
    matchingChunkIndices,
    matchingChunkIds,
  }
}
