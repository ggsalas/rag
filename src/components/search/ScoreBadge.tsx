interface ScoreBadgeProps {
  score: number
}

export function ScoreBadge({ score }: ScoreBadgeProps) {
  const percentage = Math.round(score * 100)

  const colorClass =
    score >= 0.8
      ? 'bg-muted text-foreground border border-border'
      : score >= 0.6
        ? 'text-foreground border border-border'
        : 'text-muted-foreground border border-border opacity-50'

  return (
    <span
      className={` inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}
      title={`Relevance score: ${score.toFixed(4)}`}
    >
      {percentage}%
    </span>
  )
}
