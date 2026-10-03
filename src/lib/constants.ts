import type { HybridWeights } from '@/types/search'

/**
 * Maximum characters per chunk (Markdown text).
 *
 * all-MiniLM-L6-v2 truncates at 256 tokens (~4 chars/token ≈ 1024 chars), and
 * buildEmbeddingText() prepends the sectionPath (~50–100 chars). 900 chars of
 * Markdown yield ~700–800 chars of searchText, so the final embedding text is
 * ~800–900 chars ≈ 200–225 tokens — inside the 256-token limit.
 */
export const CHUNK_SIZE = 900
/**
 * Overlap between consecutive chunks, in characters, cut at sentence
 * boundaries (~50 tokens).
 *
 * Carries sentence-level context across boundaries and lets key fragments land
 * in more than one chunk, which protects Hit@10 when normalization shifts
 * chunk boundaries.
 */
export const CHUNK_OVERLAP = 200
/**
 * Default number of search results returned to the user.
 *
 * Matches LLM_CONTEXT_CHUNKS so AI mode passes the whole result list to the LLM.
 */
export const DEFAULT_MAX_RESULTS = 10
/**
 * DEPRECATED — not used by the live search pipeline.
 *
 * Orama's hybrid score is relative (min-max normalized within the result set),
 * so the top result always scores ≈ 1.0. Gating at 75% of top therefore drops
 * relevant chunks that simply score lower than the leader. Abstention now uses
 * the cross-encoder's absolute logits (RERANKER_ABSTENTION_THRESHOLD). Kept
 * because the benchmark pipeline replica still compares against it.
 */
export const DEFAULT_MIN_SCORE = 75
/**
 * Fixed hybrid search weights (BM25 `text` / `vector`).
 *
 * Ground-truth benchmark (14 queries, 166 chunks), text/vector → nDCG@10 |
 * Hit@10 | Recall@50:
 *
 *   0.75/0.25 → 0.3405 | 0.571 | 0.910
 *   0.50/0.50 → 0.4156 | 0.714 | 0.946
 *   0.25/0.75 → 0.4565 | 0.786 | 0.969   ← optimal
 *   0.10/0.90 → 0.4183 | 0.643 | 0.939
 *
 * 0.25/0.75 wins on every metric; the former presets (0.5/0.5, 0.1/0.9) are
 * strictly dominated.
 *
 * CAVEAT — Orama truthiness bug: search-hybrid.js validates weights with
 * `hybridWeights && hybridWeights.text && hybridWeights.vector`, so a component
 * of 0 makes Orama silently discard the pair and fall back to 0.5/0.5. Never
 * pass 0 — it does NOT give text-only or vector-only search.
 */
export const DEFAULT_HYBRID_WEIGHTS: HybridWeights = { text: 0.25, vector: 0.75 }
/**
 * Minimum absolute Orama hybrid score a result must reach to be kept — guards
 * against returning the "best of an irrelevant set" when all matches are weak.
 * Benchmark-only today: search.service.ts relies on cross-encoder logits for
 * abstention instead. See also DEFAULT_MIN_SCORE.
 */
export const MIN_ABSOLUTE_SCORE = 0.5
/**
 * Query-level lexical abstention threshold (0..1) against
 * `computeLexicalCoverage(query, result.searchText)`.
 *
 * Semantics: if NO returned result reaches the threshold, the whole list is
 * dropped (`[]`). If at least one does, the full ordered list is kept —
 * including lower-coverage chunks that may still provide context. It is a
 * query-level gate, never a per-result filter.
 *
 * Benchmark: 0.5 kept Hit/Recall/MRR on positives unchanged while dropping the
 * false positive rate from 100% to 0% on vector-heavy k6/k10/k20.
 * Benchmark-only today (see MIN_ABSOLUTE_SCORE).
 */
export const MIN_QUERY_LEXICAL_COVERAGE = 0.5
/**
 * Orama BM25 `threshold` parameter (0..1).
 *
 * COUNTERINTUITIVE SEMANTICS — this has caused bugs before:
 *
 * - `1` (Orama's default): keep anything matching AT LEAST ONE query token.
 *   This is the LOOSEST setting, not the strictest — stop words such as "the"
 *   match nearly every document.
 * - `0`: require ALL query tokens; a single rare or out-of-vocabulary token
 *   empties the result set. Too strict for retrieval.
 * - `0 < t < 1`: all full matches plus a `t` fraction of partial matches.
 *   Lower values are stricter.
 *
 * Kept at 1.0 because on the 166-chunk corpus with the current tokenizer
 * (stemming + stopwords) the sweep at 0.3 / 0.5 / 1.0 (conditions D/E/F in
 * hybrid-benchmark.test.ts) gave identical metrics (nDCG@10 = 0.4156): the
 * tokenizer already removes stopwords and normalises morphology, making the
 * threshold redundant. Values below 0.5 had previously eliminated the
 * `head-shaving` query altogether on the older 104-chunk corpus.
 *
 * The constant is preserved so a sub-1.0 threshold can be reintroduced with
 * evidence. Its effect is coupled to the tokenizer: without `stemming: true`
 * and `stopWords`, a sub-1.0 threshold has nothing to filter.
 */
export const ORAMA_LEXICAL_THRESHOLD = 1.0

/** Embedding model: encodes chunks and queries for semantic search. */
export const EMBEDDING_MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'
/** Display name and approximate download size, shown in the loading toast. */
export const EMBEDDING_MODEL_DISPLAY_NAME = 'MiniLM-L6-v2'
export const EMBEDDING_MODEL_DOWNLOAD_SIZE = '~90 MB'
/** Vector width of EMBEDDING_MODEL_NAME — index and queries must match it. */
export const EMBEDDING_DIMENSIONS = 384

/**
 * Cross-encoder reranker (MS-MARCO MiniLM L-6 v2, int8): scores the top hybrid
 * candidates after retrieval and provides the abstention signal. Runs in a
 * dedicated Web Worker and is mandatory — if it fails to load, the UI reports
 * the error and offers retry (see RERANKER_ABSTENTION_THRESHOLD).
 */
export const RERANKER_MODEL_NAME = 'Xenova/ms-marco-MiniLM-L-6-v2'
/** Display name and approximate download size, shown in the loading toast. */
export const RERANKER_MODEL_DISPLAY_NAME = 'MS-MARCO MiniLM-L-6 (q8)'
export const RERANKER_MODEL_DOWNLOAD_SIZE = '~23 MB'
/**
 * How many of the lexically reranked candidates the cross-encoder scores (out
 * of the RERANK_CANDIDATE_POOL retrieved from Orama). Larger improves recall at
 * the cost of latency; 40 is the benchmark-validated default.
 */
export const RERANK_CANDIDATES_CROSS_ENCODER = 40
/**
 * Cross-encoder abstention threshold, on the model's RAW LOGITS — not sigmoid
 * probabilities. Unlike Orama's hybrid scores (relative, min-max normalized per
 * result set, so the leader always reads ≈ 1.0), these are absolute, which is
 * what makes a fixed cutoff meaningful.
 *
 * Application: after truncation, if no result reaches this logit value the
 * whole query abstains and returns [].
 *
 * CALIBRATION:
 *   - Britney Spears corpus (166 chunks; 14 positive, 6 off-topic negative
 *     queries): positives 1.12 … 9.47 vs negatives -11.06 … -7.29 — an 8.41
 *     gap, so 0.0 kept every positive and dropped every negative.
 *   - QASPER (68 chunks from 2 papers; 16 positive, 3 unanswerable): positives
 *     -5.46 … 7.78 vs unanswerable -5.72 … 0.81 — the ranges overlap, and 0.0
 *     lost 4/16 positives while letting 2/3 unanswerable through.
 *
 * WHY -6.0: below the weakest positive observed in either corpus (-5.46) yet
 * above the strongest Britney negative (-7.29), so it hides no valid answer and
 * still rejects off-topic queries. -5.46/-5.5 would fit the current data
 * slightly better, but the margin between -5.46 and -5.72 is 0.26 logits on 16
 * positives and 3 negatives — tuning there would repeat the overfitting this
 * validation exposed. -6.0 leaves a 0.54-point safety margin.
 *
 * SCOPE LIMIT: detects queries unrelated to the corpus. It does NOT reliably
 * detect plausible questions the documents cannot answer; that needs
 * answerability classification or confidence calibration and remains open.
 *
 * NO-FALLBACK POLICY: if the model fails to load the pipeline does not run —
 * the UI shows an error with retry. Falling back to lexical-only retrieval
 * would silently surface irrelevant chunks. The lexical ranker
 * (`src/lib/lexical-ranking.ts`) pre-filters candidates before the cross-encoder
 * but never replaces it for abstention.
 */
export const RERANKER_ABSTENTION_THRESHOLD = -6.0

/** Answer-generation LLM (WebGPU, main thread via @mlc-ai/web-llm). */
export const LLM_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'
/** Display name and approximate download size, shown in the enable dialog / toast. */
export const LLM_MODEL_NAME = 'Llama 3.2 1B'
export const LLM_MODEL_DOWNLOAD_SIZE = '~880 MB'
/** Top search results packed into the LLM context. Kept equal to DEFAULT_MAX_RESULTS. */
export const LLM_CONTEXT_CHUNKS = 10
/** Cap on generated answer tokens. */
export const LLM_MAX_TOKENS = 512
/**
 * Character budget for all context chunks combined (buildContext stops adding
 * chunks once it is exceeded). Sized so the prompt fits the model's context
 * window alongside the system prompt, the query, and LLM_MAX_TOKENS of output.
 */
export const LLM_CONTEXT_BUDGET_CHARS = 10_000
/** Per-chunk character cap within the LLM context (buildContext truncates each chunk). */
export const LLM_CONTEXT_CHUNK_MAX_CHARS = 1_500
