interface ScoreBadgeProps {
  score: number
}

export function ScoreBadge({ score }: ScoreBadgeProps) {
  const percentage = Math.round(score * 100)

  const colorClass =
    score >= 0.8
      ? 'bg-green-100 text-green-800'
      : score >= 0.6
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-red-100 text-red-800'

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}
      title={`Relevance score: ${score.toFixed(4)}`}
    >
      {percentage}%
    </span>
  )
}
