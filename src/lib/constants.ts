export const CHUNK_SIZE = 500
export const CHUNK_OVERLAP = 100
export const DEFAULT_MAX_RESULTS = 10
export const DEFAULT_MIN_SCORE = 70

/**
 * Hybrid search presets. Each preset defines the balance between BM25 (text)
 * and vector (semantic) contributions to the final ranking. With a retrieval-
 * tuned embedder like E5, the semantic channel is systematically more reliable
 * for vocabulary-mismatch queries, so `semantic` is the default. `keyword` and
 * `balanced` remain available for corpus/query mixes where exact-term matches
 * should dominate.
 *
 * The `text` and `vector` values here are what the UI passes; the vector-store
 * clamps any exact-0 to a tiny floor (Orama bug workaround) before use.
 */
export const HYBRID_WEIGHT_PRESETS = {
  keyword: { text: 1, vector: 0 },
  balanced: { text: 0.5, vector: 0.5 },
  semantic: { text: 0, vector: 1 },
} as const

export type HybridWeightPreset = keyof typeof HYBRID_WEIGHT_PRESETS

export const DEFAULT_HYBRID_PRESET: HybridWeightPreset = 'semantic'
export const DEFAULT_HYBRID_WEIGHTS = HYBRID_WEIGHT_PRESETS[DEFAULT_HYBRID_PRESET]

export const EMBEDDING_MODEL_NAME = 'Xenova/bge-small-en-v1.5'
export const EMBEDDING_DIMENSIONS = 384

/**
 * Role prefixes prepended to text before embedding. E5 models require
 * `query: ` / `passage: `; BGE v1.5 models accept plain text without prefixes.
 * Keep these constants together with EMBEDDING_MODEL_NAME so a model swap is
 * a single-file change.
 */
export const EMBEDDING_QUERY_PREFIX = ''
export const EMBEDDING_PASSAGE_PREFIX = ''

/**
 * Absolute score floor for hybrid search results. Chunks below this hard cutoff
 * are considered too weak to be meaningfully relevant and are dropped even if
 * they're the best available. Prevents the "best of the bad" case where the
 * only match is a stem/partial hit in unrelated content.
 */
export const MIN_ABSOLUTE_SCORE = 0.5

export const LLM_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'
export const LLM_CONTEXT_CHUNKS = 10
export const LLM_MAX_TOKENS = 512
/** Exact phrase the LLM must emit when the retrieved sources don't answer the query. */
export const LLM_NO_ANSWER_MESSAGE = "I couldn't find that in the document."
