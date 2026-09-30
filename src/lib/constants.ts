import type { HybridWeights } from '@/types/search'

/**
 * Maximum characters per chunk (Markdown text).
 *
 * all-MiniLM-L6-v2 truncates at 256 tokens (~4 chars/token ≈ 1024 chars).
 * buildEmbeddingText() prepends sectionPath (~50–100 chars), so the chunk's
 * searchText must leave room. 900 chars of Markdown typically yields ~700–800
 * chars of searchText; with a ~100-char sectionPath prefix the total embedding
 * text is ~800–900 chars ≈ 200–225 tokens, safely under the 256-token limit.
 */
export const CHUNK_SIZE = 900
/**
 * Characters of overlap between consecutive chunks.
 *
 * 150 chars ≈ 37 tokens — enough to carry sentence-level context across chunk
 * boundaries without wasting embedding budget on duplicated content.
 * Overlap is measured in characters and split at sentence boundaries.
 */
export const CHUNK_OVERLAP = 150
/**
 * Default number of search results returned to the user.
 *
 * Aligned with LLM_CONTEXT_CHUNKS (10) so that in AI mode the LLM receives
 * the full result list without the dead `results.slice(0, 10)` in
 * llm.service.ts being a no-op. Previously DEFAULT_MAX_RESULTS was 6, which
 * meant the LLM slice never actually truncated anything — the two constants
 * were silently decoupled.
 */
export const DEFAULT_MAX_RESULTS = 10
/**
 * DEPRECATED — no longer used as a gate.
 *
 * Orama's hybrid score is relative (min-max normalized within the result set),
 * so the top result always has score ≈ 1.0. Applying a relative threshold of
 * 75% of top was effectively filtering out results below 0.75, which destroyed
 * relevant chunks that happened to have lower relative scores. The cross-encoder
 * reranker now provides absolute logits for abstention; this constant is kept
 * only for backward compatibility with persisted search preferences and the
 * legacy rerank/rrf/fused services. New code should use RERANKER_ABSTENTION_THRESHOLD.
 */
export const DEFAULT_MIN_SCORE = 75
/**
 * Fixed hybrid search weights (BM25 / vector).
 *
 * Validated on ground-truth benchmark (14 queries, 166 chunks):
 *
 *   text/vector | nDCG@10 | Hit@10 | Recall@50
 *   -------------------------------------------
 *   0.75/0.25   | 0.3405  | 0.571  | 0.910
 *   0.50/0.50   | 0.4156  | 0.714  | 0.946
 *   0.25/0.75   | 0.4565  | 0.786  | 0.969   ← optimal
 *   0.10/0.90   | 0.4183  | 0.643  | 0.939
 *
 * The 0.25/0.75 split is optimal for both nDCG@10 and Recall@50, making it
 * a stable choice. The previous presets ("balanced" 0.5/0.5 and "semantic"
 * 0.1/0.9) are strictly dominated on all measured metrics.
 *
 * CAVEAT — Orama truthiness bug: in Orama's search-hybrid.js the check is
 *   `hybridWeights && hybridWeights.text && hybridWeights.vector`
 * If either component is 0, Orama silently discards the weights and falls
 * back to 0.5/0.5. Never pass a weight of 0 — it does NOT produce pure
 * text-only or vector-only search.
 */
export const DEFAULT_HYBRID_WEIGHTS: HybridWeights = { text: 0.25, vector: 0.75 }
/**
 * Minimum absolute hybrid score a result must reach to be returned.
 * Prevents surfacing the "best of irrelevant" when all matches are poor.
 * Applied in addition to the user-configurable relative minScore threshold.
 */
export const MIN_ABSOLUTE_SCORE = 0.5
/**
 * Query-level lexical abstention threshold (0..1).
 *
 * After score filtering and truncation, if **none** of the returned results has
 * `computeLexicalCoverage(trimmedQuery, result.searchText) >= MIN_QUERY_LEXICAL_COVERAGE`,
 * the entire result list is replaced with `[]` (abstain on the whole query).
 * If at least one result qualifies, the full ordered list is preserved
 * (including lower-coverage results that may still provide useful context).
 *
 * This is a **query-level** gate, not a per-result filter. Validated on the
 * benchmark: threshold 0.5 preserved positive Hit/Recall/MRR exactly while
 * reducing FPR from 100% to 0% for vector-heavy k6/k10/k20.
 */
export const MIN_QUERY_LEXICAL_COVERAGE = 0.5
/**
 * Orama BM25 `threshold` parameter (0..1).
 *
 * COUNTERINTUITIVE SEMANTICS — read carefully, this has caused bugs before:
 *
 * - `threshold === 1` (Orama's default): returns ANY document that matches
 *   AT LEAST ONE token of the query. This is the loosest setting, not the
 *   strictest. With natural-language queries like "Who wrote the play Hamlet?",
 *   the stop word "the" matches nearly every document in the corpus.
 *
 * - `threshold === 0`: requires ALL query tokens to be present. If ANY token
 *   is missing from the index, returns []. Too strict for retrieval — a single
 *   rare token kills the entire query.
 *
 * - `0 < threshold < 1`: returns full matches (all tokens present) PLUS a
 *   fraction `threshold` of partial matches (some tokens missing). Lower
 *   values are stricter.
 *
 * VALIDATED ON REAL CORPUS (166 chunks, new chunking + tokenizer):
 *
 * Phase 1 threshold sweep (conditions D, E, F in hybrid-benchmark.test.ts)
 * measured nDCG@10 with the new tokenizer (stemming + stopwords) at three
 * threshold values:
 *   - D: threshold 0.5 → nDCG@10 = 0.4156
 *   - E: threshold 1.0 → nDCG@10 = 0.4156  (identical)
 *   - F: threshold 0.3 → nDCG@10 = 0.4156  (identical)
 *
 * All three conditions produce identical metrics. The threshold has NO
 * measurable effect when the tokenizer already handles stopword removal and
 * stemming. We revert to 1.0 (Orama's default) because:
 *   1. It is the simplest, most predictable setting.
 *   2. Values below 0.5 previously caused an "acantilado" that eliminated the
 *      `head-shaving` query from results entirely (observed on the old 104-chunk
 *      corpus without the new tokenizer).
 *   3. With the new tokenizer, the threshold is redundant — the tokenizer
 *      already filters stopwords and normalises morphology.
 *
 * The constant and its semantics are preserved (rather than removed) so that
 * if future data shows a use case for sub-1.0 thresholds (e.g. a different
 * tokenizer or corpus characteristics), it can be reintroduced with evidence.
 *
 * MUST be combined with `stemming: true` and `stopWords` in the tokenizer
 * config — without stopwords, a sub-1.0 threshold has nothing to filter
 * (the axes are coupled).
 */
export const ORAMA_LEXICAL_THRESHOLD = 1.0

export const EMBEDDING_MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'
/** User-facing embedding model name and approximate download size (shown in the loading toast). */
export const EMBEDDING_MODEL_DISPLAY_NAME = 'MiniLM-L6-v2'
export const EMBEDDING_MODEL_DOWNLOAD_SIZE = '~90 MB'
export const EMBEDDING_DIMENSIONS = 384

/**
 * Cross-encoder model (MS-MARCO MiniLM L-6 v2, quantized int8).
 * Used to rank the top-N hybrid candidates after initial retrieval.
 * Runs in a dedicated Web Worker. Mandatory for search — if the model
 * fails to load, the UI shows an error and allows retry.
 */
export const RERANKER_MODEL_NAME = 'Xenova/ms-marco-MiniLM-L-6-v2'
/** User-facing model name and approximate download size (shown in the loading toast). */
export const RERANKER_MODEL_DISPLAY_NAME = 'MS-MARCO MiniLM-L-6 (q8)'
export const RERANKER_MODEL_DOWNLOAD_SIZE = '~23 MB'
/**
 * Number of hybrid candidates to rerank with the cross-encoder.
 * Larger values improve recall at the cost of latency. 40 is the default
 * validated on the benchmark; tune via RERANK_CANDIDATE_POOL_CROSS_ENCODER
 * if experimentation warrants it.
 */
export const RERANK_CANDIDATES_CROSS_ENCODER = 40
/**
 * Abstention threshold for the cross-encoder (logit scale).
 *
 * The cross-encoder returns raw logits (not sigmoid probabilities). These are
 * absolute scores, unlike Orama's hybrid scores which are relative (min-max
 * normalized within the result set, so the top result always has score ≈ 1.0).
 *
 * CALIBRATION HISTORY:
 *
 * Original calibration on Britney Spears corpus (166 chunks, 14 positive,
 * 6 artificial negatives like "Who wrote Hamlet?"):
 *   - Positive queries: min = 1.12, max = 9.47
 *   - Negative queries: min = -11.06, max = -7.29
 *   - Gap: +8.41 (perfect separation)
 *   - Threshold 0.0 retained all positives, filtered all negatives
 *
 * Multi-document validation on QASPER (68 chunks from 2 academic papers,
 * 16 positive, 3 unanswerable):
 *   - Positive queries: min = -5.46, max = 7.78, median = 3.72
 *   - Unanswerable queries: min = -5.72, max = 0.81, median = -4.71
 *   - Gap: -6.27 (MASSIVE OVERLAP)
 *   - Threshold 0.0 retained 12/16 positives (lost 4 correct answers) and
 *     filtered only 1/3 unanswerable (let 2 pass). Failed in both directions.
 *
 * WHY -6.0:
 *
 * The threshold -6.0 is below all observed positive logits in both corpora
 * (Britney min 1.12, QASPER min -5.46), so it does NOT hide valid answers.
 * It still filters all 6 artificial negatives from Britney (max -7.29).
 *
 * We deliberately do NOT choose -5.46 or -5.5, even though those would score
 * marginally better on the current data. The gap between the lowest positive
 * (-5.46) and the lowest unanswerable (-5.72) is only 0.26 logit points on
 * a sample of 16 positives and 3 negatives. Tuning to that boundary would
 * repeat the exact overfitting this validation just exposed. The -6.0 value
 * provides a 0.54-point safety margin below the weakest observed positive.
 *
 * LIMITATION:
 *
 * This threshold detects queries with NO relationship to the corpus (completely
 * off-topic questions). It does NOT reliably detect plausible questions that
 * have no answer in the document. That problem remains open and requires a
 * different approach (e.g., answerability classification, confidence calibration).
 *
 * DEGRADATION POLICY:
 *
 * If the cross-encoder model fails to load, the search pipeline does NOT
 * execute — the UI shows an error and a retry button. There is no fallback
 * to lexical-only retrieval: returning results without the cross-encoder
 * would silently surface irrelevant chunks. The cross-encoder is the only
 * validated abstention mechanism in production. The lexical ranker
 * (`src/lib/lexical-ranking.ts`) is used as a pre-filter before
 * cross-encoder ranking, but does not replace it for abstention.
 *
 * LOAD FAILURE POLICY:
 *
 * If the cross-encoder model fails to load, the search pipeline does NOT
 * execute — the UI shows an error and a retry button. There is no fallback
 * to lexical-only retrieval: returning results without the cross-encoder
 * would silently surface irrelevant chunks.
 */
export const RERANKER_ABSTENTION_THRESHOLD = -6.0

export const LLM_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'
/** User-facing model name and approximate download size (shown in the enable dialog / toast). */
export const LLM_MODEL_NAME = 'Llama 3.2 1B'
export const LLM_MODEL_DOWNLOAD_SIZE = '~880 MB'
export const LLM_CONTEXT_CHUNKS = 10
export const LLM_MAX_TOKENS = 512
/**
 * Maximum total characters for all context chunks combined sent to the LLM.
 * The model has a 4096-token context window; at ~4 chars/token for plain text,
 * this leaves room for the system prompt, query, and output tokens (LLM_MAX_TOKENS).
 */
export const LLM_CONTEXT_BUDGET_CHARS = 10_000
/** Maximum characters contributed by a single chunk to the LLM context. */
export const LLM_CONTEXT_CHUNK_MAX_CHARS = 1_500
