/**
 * Benchmark types for evaluating search quality against a labeled corpus.
 *
 * These types are intentionally decoupled from Dexie, Orama, React, and the LLM
 * so the evaluation helpers stay pure and unit-testable.
 */

/**
 * Minimal chunk shape required by the evaluation helpers.
 *
 * `SearchResult` from `@/types/search` is structurally compatible — callers can
 * pass real results straight through without mapping.
 */
export type BenchmarkChunk = {
  chunkId: string
  /** Sanitized Markdown text shown to the user */
  text: string
  /** Plain text used for retrieval (BM25) */
  searchText: string
}

/**
 * A single benchmark case: a query plus the anchor terms we expect to find in
 * the retrieved chunks.
 *
 * Positive cases distinguish between **required** and **supporting** anchors:
 *
 * - `requiredAnchors` — every one must appear (case-insensitive substring) in
 *   a chunk for it to count as a "hit". These are the core answer facts.
 * - `supportingAnchors` — optional context clues (dates, locations, related
 *   terms). They are surfaced in diagnostics but must **not** independently
 *   make a chunk a hit.
 *
 * Negative cases have empty `requiredAnchors` and are used to measure
 * false-positive rate.
 *
 * NOTE: anchor-term evaluation is provisional until the user labels actual
 * chunk IDs from their indexed Britney Spears PDF. Anchors are a coarse proxy
 * for "the chunk contains the fact the question asks about".
 */
export type BenchmarkCase = {
  /** Unique, human-readable identifier (e.g. "debut-single") */
  id: string
  /** The query to run against the search pipeline */
  query: string
  /**
   * Required anchor terms — ALL must appear (case-insensitive substring) in a
   * chunk for it to count as a hit. Empty for negative cases.
   */
  requiredAnchors: string[]
  /**
   * Optional supporting anchor terms (dates, locations, related terms).
   * Surfaced in diagnostics but do NOT independently make a hit.
   */
  supportingAnchors: string[]
  /** Whether this is a positive (should match) or negative (should not) case */
  kind: 'positive' | 'negative'
}

/**
 * A literal text fragment from the source document with a graded relevance
 * label.
 *
 * Fragments are matched as substrings after NFC normalization and whitespace
 * collapsing, so they are resilient to PDF line-wrap artifacts.
 */
export type Fragment = {
  /** Literal text substring from the source document */
  text: string
  /** Relevance grade: 2 = directly answers the query, 1 = useful context */
  grade: 1 | 2
}

/**
 * Benchmark case with fragment-based ground truth and graded relevance.
 *
 * Unlike the anchor-based `BenchmarkCase`, this type uses literal text
 * fragments from the source document. A chunk is relevant if it contains any
 * fragment (substring match after NFC normalization and whitespace collapsing).
 * When a chunk matches multiple fragments, it takes the maximum grade.
 *
 * This design is robust to chunking strategy changes: whether the pipeline
 * produces 104 or 166 chunks, the relevance labels remain consistent because
 * they are anchored to the source text, not to chunk boundaries.
 */
export type GradedBenchmarkCase = {
  /** Unique, human-readable identifier (e.g. "debut-single") */
  id: string
  /** The query to run against the search pipeline */
  query: string
  /** Literal text fragments with graded relevance. Empty for negative cases. */
  fragments: Fragment[]
  /** Whether this is a positive (should match) or negative (should not) case */
  kind: 'positive' | 'negative'
}

/** Per-chunk relevance result from the resolver */
export type ChunkRelevance = {
  chunkId: string
  grade: number
}

/** Aggregate graded metrics returned by the evaluation runner */
export type GradedMetrics = {
  /** Mean nDCG@10 across positive cases */
  ndcgAt10: number
  /** Mean Hit@10 across positive cases (1 if any top-10 chunk is relevant) */
  hitAt10: number
  /** Mean Recall@10 across positive cases (gain-based) */
  recallAt10: number
}

/** Aggregate metrics returned by the evaluation runner */
export type BenchmarkMetrics = {
  /** Mean hit@k across positive cases (1 if any top-k chunk is a hit) */
  hitAtK: number
  /** Mean recall@k across positive cases (fraction of anchors covered) */
  recallAtK: number
  /** Mean precision@k across positive cases (fraction of top-k that are hits) */
  precisionAtK: number
  /** Mean reciprocal rank across positive cases (0 when no hit is found) */
  mrr: number
  /** Fraction of negative cases that returned at least one chunk */
  falsePositiveRate: number
  /** The k value these metrics were computed at */
  k: number
}
