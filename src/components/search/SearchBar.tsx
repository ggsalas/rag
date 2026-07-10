import {
  useState,
  useRef,
  useEffect,
  type FormEvent,
  type ChangeEvent,
} from 'react'
import { X, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ModelStatus } from '@/store/app.store'
import type { HybridWeights } from '@/types/search'

interface SearchBarProps {
  onSearch: (query: string) => void
  isSearching: boolean
  modelStatus: ModelStatus
  initialQuery?: string
  hybridWeights?: HybridWeights
  onWeightsChange?: (weights: HybridWeights) => void
  maxResults?: number
  onMaxResultsChange?: (n: number) => void
  minScore?: number
  onMinScoreChange?: (n: number) => void
  notFocused?: boolean
  isAiMode?: boolean
  onAiModeToggle?: () => void
  llmMaxTokens?: number
  onLlmMaxTokensChange?: (n: number) => void
}

export function SearchBar({
  onSearch,
  modelStatus,
  initialQuery = '',
  hybridWeights,
  onWeightsChange,
  maxResults,
  onMaxResultsChange,
  minScore,
  onMinScoreChange,
  notFocused,
  isAiMode = false,
  onAiModeToggle,
  llmMaxTokens,
  onLlmMaxTokensChange,
}: SearchBarProps) {
  const [inputValue, setInputValue] = useState(initialQuery)
  const [localWeight, setLocalWeight] = useState(hybridWeights?.vector ?? 0.5)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!notFocused) inputRef.current?.focus({ preventScroll: true })
  }, [notFocused])

  useEffect(() => {
    if (hybridWeights !== undefined) setLocalWeight(hybridWeights.vector)
  }, [hybridWeights?.vector])

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

  const handleSliderChange = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalWeight(parseFloat(e.target.value))
  }

  const handleSliderRelease = () => {
    onWeightsChange?.({ vector: localWeight, text: 1 - localWeight })
  }

  const isDisabled = modelStatus !== 'ready'
  const hasText = inputValue.trim().length > 0
  const showWeights =
    hybridWeights !== undefined && onWeightsChange !== undefined
  const showConfig =
    showWeights ||
    (maxResults !== undefined && minScore !== undefined) ||
    !!onAiModeToggle

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
                  ? 'Waiting for embedding model to load...'
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

                    {showWeights && (
                      <>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          Keyword
                        </span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.1"
                          value={localWeight}
                          onChange={handleSliderChange}
                          onMouseUp={handleSliderRelease}
                          onTouchEnd={handleSliderRelease}
                          disabled={isDisabled}
                          className="flex-1 min-w-20 h-1.5 accent-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          Semantic
                        </span>
                      </>
                    )}

                    {maxResults !== undefined && onMaxResultsChange && (
                      <>
                        <div className="w-px h-4 bg-border mx-1" />
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

                    {minScore !== undefined && onMinScoreChange && (
                      <>
                        <div className="w-px h-4 bg-border mx-1" />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          Min score
                        </span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={minScore}
                          onChange={(e) =>
                            onMinScoreChange(
                              Math.min(
                                100,
                                Math.max(0, parseInt(e.target.value) || 0),
                              ),
                            )
                          }
                          disabled={isDisabled}
                          className="w-12 text-xs text-center border border-border rounded px-1 py-0.5 outline-none focus:border-ring disabled:opacity-50 text-foreground"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {modelStatus === 'loading' && (
        <p className="mt-2 text-sm text-muted-foreground">
          Loading embedding model... Search will be available once the model is
          ready.
        </p>
      )}
      {modelStatus === 'error' && (
        <p className="mt-2 text-sm text-foreground">
          Embedding model failed to load. Search is unavailable.
        </p>
      )}
    </div>
  )
}
