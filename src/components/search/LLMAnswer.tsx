import { Sparkles } from 'lucide-react'
import type { LLMCitation } from '@/services/llm/llm.service'

interface LLMAnswerProps {
  answer: string
  citations: LLMCitation[]
  isGenerating: boolean
  error: string | null
  onCitationClick: (citation: LLMCitation) => void
}

function AnswerText({
  text,
  citations,
  onCitationClick,
}: {
  text: string
  citations: LLMCitation[]
  onCitationClick: (c: LLMCitation) => void
}) {
  const parts = text.split(/(\[\d+\])/)
  return (
    <p className="text-base text-foreground leading-relaxed whitespace-pre-wrap">
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/)
        if (match?.[1]) {
          const idx = parseInt(match[1])
          const citation = citations.find((c) => c.index === idx)
          if (citation) {
            return (
              <button
                key={i}
                type="button"
                onClick={() => onCitationClick(citation)}
                className="inline-flex cursor-pointer items-center justify-center w-5 h-5 text-xs font-semibold text-foreground bg-muted rounded hover:bg-accent transition-colors align-baseline mx-0.5"
                title={citation.documentName}
              >
                {idx}
              </button>
            )
          }
        }
        return <span key={i}>{part}</span>
      })}
    </p>
  )
}

export function LLMAnswer({
  answer,
  citations,
  isGenerating,
  error,
  onCitationClick,
}: LLMAnswerProps) {
  if (error) {
    return (
      <div className="rounded-lg border border-border bg-muted p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-foreground shrink-0" />
          <span className="text-sm text-foreground">{error}</span>
        </div>
      </div>
    )
  }

  if (!isGenerating && !answer) return null

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4 text-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground">AI Answer</span>
        {isGenerating && (
          <span className="flex gap-0.5 ml-auto">
            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" />
          </span>
        )}
      </div>

      {answer && (
        <AnswerText
          text={answer}
          citations={citations}
          onCitationClick={onCitationClick}
        />
      )}
    </div>
  )
}
