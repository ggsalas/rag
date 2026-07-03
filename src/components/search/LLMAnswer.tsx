import { Link, useParams, useSearchParams } from 'react-router'
import type { LLMCitation } from '@/services/llm/llm.service'
import type { LLMStatus } from '@/store/app.store'
import type { SavedAi } from './ResultList'

interface LLMAnswerProps {
  answer: string
  citations: LLMCitation[]
  isGenerating: boolean
  llmStatus: LLMStatus
  llmProgress: number
  error: string | null
  savedAi?: SavedAi
}

function citationHref(libraryId: string, c: LLMCitation, query: string, savedAi?: SavedAi) {
  const base = `/libraries/${libraryId}/documents/${c.documentId}?chunk=${c.chunkIndex}`
  return { to: base, state: { searchQuery: query, savedAi } }
}

function AnswerText({
  text,
  citations,
  libraryId,
  query,
  savedAi,
}: {
  text: string
  citations: LLMCitation[]
  libraryId: string
  query: string
  savedAi?: SavedAi
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
            const { to, state } = citationHref(libraryId, citation, query, savedAi)
            return (
              <Link
                key={i}
                to={to}
                state={state}
                className="inline-flex items-center justify-center w-5 h-5 text-xs font-semibold text-blue-700 bg-blue-100 rounded hover:bg-blue-200 transition-colors align-baseline mx-0.5"
                title={`${citation.documentName}${citation.page ? ` · p.${citation.page}` : ''}`}
              >
                {idx}
              </Link>
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
  savedAi,
}: LLMAnswerProps) {
  const { libraryId } = useParams<{ libraryId: string }>()
  const [searchParams] = useSearchParams()
  const currentQuery = searchParams.get('q') ?? ''
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
          {llmProgress}% — downloading Llama 3.2 1B (~880 MB, cached after first load)
        </p>
      </div>
    )
  }

  if (llmStatus === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-4 w-4 text-red-500 shrink-0" />
          <span className="text-sm text-red-700">
            Failed to load AI model. Check the browser console for details.
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
          libraryId={libraryId!}
          query={currentQuery}
          savedAi={savedAi}
        />
      )}

      {!isGenerating && citations.length > 0 && (
        <div className="mt-3 pt-3 border-t border-blue-200">
          <p className="text-xs font-medium text-blue-600 mb-1.5">Sources</p>
          <div className="flex flex-wrap gap-1.5">
            {citations.map((c) => {
              const { to, state } = citationHref(libraryId!, c, currentQuery, savedAi)
              return (
                <Link
                  key={c.chunkId}
                  to={to}
                  state={state}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-white border border-blue-200 rounded-full text-blue-700 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                >
                  <span className="font-semibold">[{c.index}]</span>
                  <span className="text-blue-600/80 max-w-[140px] truncate">
                    {c.documentName}
                  </span>
                  {c.page && <span className="text-blue-500">p.{c.page}</span>}
                </Link>
              )
            })}
          </div>
        </div>
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
