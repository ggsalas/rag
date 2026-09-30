/**
 * English stop words used across the search pipeline.
 *
 * Single source of truth — consumed by:
 *   - `dev/benchmarks/search/rerank.service.ts` (lexical coverage, dev/benchmark only)
 *   - `services/embedding/vector-store.ts` (Orama tokenizer configuration)
 *
 * The list is intentionally small and deterministic: no stemming, no locale
 * awareness. It covers the most common English function words (articles,
 * prepositions, pronouns, auxiliaries, conjunctions) that carry negligible
 * retrieval signal and would otherwise dominate BM25 scores.
 *
 * Kept as a `Set` for O(1) membership checks in tokenisation loops.
 */
export const ENGLISH_STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
  'to', 'of', 'in', 'for', 'on', 'at', 'by', 'with', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'if', 'while', 'about', 'up', 'down', 'it', 'its',
  'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you',
  'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their',
  'what', 'which', 'who', 'whom',
])

/**
 * Array form for Orama's tokenizer `stopWords` option, which expects
 * `string[]` (not `Set<string>`).
 *
 * Kept as a stable sorted array so the tokenizer configuration is
 * deterministic across runs.
 */
export const ENGLISH_STOP_WORDS_ARRAY: string[] = Array.from(ENGLISH_STOP_WORDS).sort()
