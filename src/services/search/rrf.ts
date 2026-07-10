/**
 * Reciprocal Rank Fusion — combines multiple rankings of the same items into
 * a single ranking, based purely on rank position (not raw scores).
 *
 * For each item, RRF sums 1/(k + rank) across every ranking it appears in.
 * Items ranked high in many rankings win; items ranked high in just one
 * ranking also survive (unlike averaging, which penalises absence).
 *
 * The constant `k` (default 60) is from Cormack, Clarke, and Buettcher (2009)
 * and is robust across domains — it dampens the boost from the very top
 * positions so that a rank-1 in one list doesn't dominate rank-3 in three lists.
 */
export function rrfFuse<T>(
  rankings: T[][],
  getId: (item: T) => string,
  k: number = 60,
  limit?: number,
): T[] {
  const scores = new Map<string, number>()
  const items = new Map<string, T>()

  for (const ranking of rankings) {
    ranking.forEach((item, rank) => {
      const id = getId(item)
      const contribution = 1 / (k + rank + 1)
      scores.set(id, (scores.get(id) ?? 0) + contribution)
      if (!items.has(id)) items.set(id, item)
    })
  }

  const fused = Array.from(items.values()).sort(
    (a, b) => (scores.get(getId(b)) ?? 0) - (scores.get(getId(a)) ?? 0),
  )

  // Rewrite each item's score to a NORMALISED RRF score in [0, 1]. Raw RRF
  // sums are tiny (max ≈ 4/61 with 4 rankings), which makes downstream
  // consumers — score badges, percent-based thresholds — meaningless. Dividing
  // by the top score restores the "top = 100%" convention that plain hybrid
  // search produced, so the min-score slider and the badge colours keep
  // working across both retrieval paths.
  const topFusedScore = fused.length > 0 ? (scores.get(getId(fused[0]!)) ?? 0) : 0
  const result = fused.map((item) => {
    const fusedScore = scores.get(getId(item)) ?? 0
    const normalised = topFusedScore > 0 ? fusedScore / topFusedScore : 0
    return 'score' in (item as object)
      ? ({ ...(item as object), score: normalised } as T)
      : item
  })

  return limit ? result.slice(0, limit) : result
}
