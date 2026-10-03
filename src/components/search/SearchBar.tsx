import { useState, useRef, useEffect, type FormEvent } from 'react'
import { X, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ModelStatus } from '@/store/app.store'
import type { SearchModelsStatus } from '@/hooks/useSearchModels'

interface SearchBarProps {
  onSearch: (query: string) => void
  isSearching: boolean
  /** @deprecated Use `searchModelsStatus` instead. Retained for backward compat during transition. */
  embeddingStatus?: ModelStatus
  /** Combined status of embedding + cross-encoder models. Search is blocked unless `ready`. */
  searchModelsStatus: SearchModelsStatus
  /** Per-model statuses for granular progress messages. */
  embeddingStatusDetailed: ModelStatus
  crossEncoderStatusDetailed: ModelStatus
  initialQuery?: string
  maxResults?: number
  onMaxResultsChange?: (n: number) => void
  notFocused?: boolean
  isAiMode?: boolean
  onAiModeToggle?: () => void
  llmMaxTokens?: number
  onLlmMaxTokensChange?: (n: number) => void
  onRetryModels?: () => void
}

export function SearchBar({
  onSearch,
  searchModelsStatus,
  embeddingStatusDetailed,
  crossEncoderStatusDetailed,
  initialQuery = '',
  maxResults,
  onMaxResultsChange,
  notFocused,
  isAiMode = false,
  onAiModeToggle,
  llmMaxTokens,
  onLlmMaxTokensChange,
  onRetryModels,
}: SearchBarProps) {
  const [inputValue, setInputValue] = useState(initialQuery)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!notFocused) inputRef.current?.focus({ preventScroll: true })
  }, [notFocused])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    inputRef.current?.blur()
    onSearch(inputValue)
  }

  const handleClear = () => {
    setInputValue('')
    onSearch('')
    inputRef.current?.focus()
  }

  const isDisabled = searchModelsStatus !== 'ready'
  const hasText = inputValue.trim().length > 0
  const showConfig = maxResults !== undefined || !!onAiModeToggle

  return (
    <div>
      <div className="group relative">
        {/* Invisible placeholder keeps layout stable when the box expands downward */}
        <div
          className="invisible pointer-events-none select-none border border-transparent px-4 py-3 text-base"
          aria-hidden="true"
        >
          &nbsp;
        </div>

        {/* Actual search box — absolutely positioned, expands on focus */}
        <div
          className={`
            absolute inset-x-0 top-0 z-10 rounded-lg border bg-background
            focus-within:border-border focus-within:border-[3px] focus-within:border-foreground
            ${isDisabled ? 'border-border bg-muted' : 'border-input'}
          `}
        >
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 px-3 py-2.5"
          >
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={
                isDisabled
                  ? 'Waiting for search models to load...'
                  : 'Search your documents...'
              }
              disabled={isDisabled}
              className="flex-1 min-w-0 bg-transparent outline-none text-foreground placeholder-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            />

            {hasText && (
              <button
                type="button"
                onClick={handleClear}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <X className="h-5 w-5" />
              </button>
            )}

            <div className="w-px h-5 bg-border shrink-0" />

            <button
              type="submit"
              disabled={isDisabled || !hasText}
              className="shrink-0 px-3 py-1 text-sm font-medium rounded-md border border-primary bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-transparent disabled:text-muted-foreground disabled:border-border disabled:cursor-not-allowed transition-colors"
            >
              Ask
            </button>
          </form>

          {showConfig && (
            <div className="grid grid-rows-[0fr] opacity-0 group-focus-within:grid-rows-[1fr] group-focus-within:opacity-100 transition-[grid-template-rows,opacity] duration-200 delay-[150ms] group-focus-within:delay-0">
              <div className="overflow-hidden">
                <div className="border-t border-border px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {onAiModeToggle && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={onAiModeToggle}
                          disabled={isDisabled}
                          className={`gap-1 text-xs! ${
                            isAiMode
                              ? ''
                              : 'text-muted-foreground! hover:text-foreground!'
                          }`}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          AI answer
                        </Button>
                        {isAiMode &&
                          llmMaxTokens !== undefined &&
                          onLlmMaxTokensChange && (
                            <select
                              value={llmMaxTokens}
                              onChange={(e) =>
                                onLlmMaxTokensChange(Number(e.target.value))
                              }
                              disabled={isDisabled}
                              className="text-xs text-muted-foreground bg-background border border-border rounded px-1 py-0.5 outline-none focus:border-ring disabled:opacity-50"
                            >
                              <option value={256}>Short</option>
                              <option value={512}>Default</option>
                              <option value={1024}>Large</option>
                            </select>
                          )}
                        <div className="w-px h-4 bg-border mx-1" />
                      </>
                    )}

                    {maxResults !== undefined && onMaxResultsChange && (
                      <>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          Max results
                        </span>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={maxResults}
                          onChange={(e) =>
                            onMaxResultsChange(
                              Math.max(1, parseInt(e.target.value) || 1),
                            )
                          }
                          disabled={isDisabled}
                          className="w-12 text-xs text-center border border-border rounded px-1 py-0.5 outline-none focus:border-ring disabled:opacity-50 text-foreground"
                        />
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {searchModelsStatus === 'error' && (
        <div className="mt-2 space-y-1">
          <p className="text-sm text-foreground">
            Search is unavailable — one or more models failed to load.
          </p>
          {embeddingStatusDetailed === 'error' && (
            <p className="text-xs text-foreground">• Embedding model failed.</p>
          )}
          {crossEncoderStatusDetailed === 'error' && (
            <p className="text-xs text-foreground">• Cross-encoder model failed.</p>
          )}
          {onRetryModels && (
            <button
              type="button"
              onClick={onRetryModels}
              className="mt-1 text-sm text-primary underline hover:text-primary-hover"
            >
              Retry loading models
            </button>
          )}
        </div>
      )}
    </div>
  )
}
