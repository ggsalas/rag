import type {
  BenchmarkChunk,
  GradedBenchmarkCase,
  ChunkRelevance,
} from './search-benchmark.types'

/**
 * Pure relevance-resolution helpers for fragment-based graded evaluation.
 *
 * Given a list of chunks and a `GradedBenchmarkCase`, determines which chunks
 * are relevant and at what grade. A chunk is relevant if it contains any
 * fragment (substring match after NFC normalization and whitespace collapsing).
 * When a chunk matches multiple fragments, it takes the maximum grade.
 *
 * This design is robust to chunking strategy changes: whether the pipeline
 * produces 104 or 166 chunks, the relevance labels remain consistent because
 * they are anchored to the source text, not to chunk boundaries.
 */

/**
 * Normalizes a string for fragment matching: Unicode NFC normalization, collapse
 * all whitespace runs to a single space, trim, and lowercase.
 */
function normalize(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Returns the relevance grade for a single chunk against a graded case.
 *
 * Checks the chunk's `searchText` (retrieval text) for substring matches
 * against each fragment. Returns the maximum grade among all matching
 * fragments, or 0 if no fragment matches.
 *
 * For negative cases (no fragments), always returns 0.
 */
export function chunkRelevanceGrade(
  chunk: BenchmarkChunk,
  case_: GradedBenchmarkCase,
): number {
  if (case_.kind === 'negative' || case_.fragments.length === 0) return 0

  const normalizedText = normalize(chunk.searchText)
  let maxGrade = 0

  for (const fragment of case_.fragments) {
    const normalizedFragment = normalize(fragment.text)
    if (!normalizedFragment) continue
    if (normalizedText.includes(normalizedFragment)) {
      maxGrade = Math.max(maxGrade, fragment.grade)
    }
  }

  return maxGrade
}

/**
 * Resolves relevance for a list of chunks against a graded case.
 *
 * Returns an array of `ChunkRelevance` objects for chunks that have grade > 0.
 * Chunks with no matching fragments are omitted from the result.
 *
 * The order of the result matches the order of the input chunks.
 */
export function resolveRelevance(
  chunks: BenchmarkChunk[],
  case_: GradedBenchmarkCase,
): ChunkRelevance[] {
  const result: ChunkRelevance[] = []

  for (const chunk of chunks) {
    const grade = chunkRelevanceGrade(chunk, case_)
    if (grade > 0) {
      result.push({ chunkId: chunk.chunkId, grade })
    }
  }

  return result
}

/**
 * Extracts the relevance grades from a ranked list of chunks, in rank order.
 *
 * Returns an array where each element is the relevance grade (0, 1, or 2) of
 * the corresponding chunk in the input. This is the input format expected by
 * the nDCG and gain-based metrics.
 */
export function relevanceVector(
  rankedChunks: BenchmarkChunk[],
  case_: GradedBenchmarkCase,
): number[] {
  return rankedChunks.map((chunk) => chunkRelevanceGrade(chunk, case_))
}
