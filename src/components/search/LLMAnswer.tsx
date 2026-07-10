import type { LLMCitation } from '@/services/llm/llm.service'
import type { ModelStatus } from '@/store/app.store'

interface LLMAnswerProps {
  answer: string
  citations: LLMCitation[]
  isGenerating: boolean
  llmStatus: ModelStatus
  llmProgress: number
  error: string | null
  loadError?: string | null
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
    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
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
                className="inline-flex items-center justify-center w-5 h-5 text-xs font-semibold text-blue-700 bg-blue-100 rounded hover:bg-blue-200 transition-colors align-baseline mx-0.5"
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
  llmStatus,
  llmProgress,
  error,
  loadError,
  onCitationClick,
}: LLMAnswerProps) {
  if (llmStatus === 'loading') {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-center gap-2 mb-2">
          <SparklesIcon className="h-4 w-4 text-blue-600 shrink-0" />
          <span className="text-sm font-medium text-blue-700">
            Loading AI model…
          </span>
        </div>
        <div className="h-1.5 bg-blue-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300"
            style={{ width: `${llmProgress}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-blue-600">
          {llmProgress}% — downloading Llama 3.2 1B (~880 MB, cached after first
          load)
        </p>
      </div>
    )
  }

  if (llmStatus === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-2">
          <SparklesIcon className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <span className="text-sm text-red-700">
            {loadError ?? 'Failed to load AI model.'}
          </span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-4 w-4 text-red-500 shrink-0" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
      </div>
    )
  }

  if (!isGenerating && !answer) return null

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <SparklesIcon className="h-4 w-4 text-blue-600 shrink-0" />
        <span className="text-sm font-medium text-blue-700">AI Answer</span>
        {isGenerating && (
          <span className="flex gap-0.5 ml-auto">
            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" />
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

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
      />
    </svg>
  )
}
