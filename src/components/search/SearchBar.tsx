import { useState, useRef, useEffect, type FormEvent } from 'react'
import type { ModelStatus } from '@/store/app.store'
import type { HybridWeights } from '@/types/search'
import { HYBRID_WEIGHT_PRESETS, type HybridWeightPreset } from '@/lib/constants'

/** Maps a HybridWeights value to its matching preset name (falls back to 'balanced'). */
function presetOf(w: HybridWeights | undefined): HybridWeightPreset {
  if (!w) return 'balanced'
  for (const [name, preset] of Object.entries(HYBRID_WEIGHT_PRESETS)) {
    if (preset.text === w.text && preset.vector === w.vector) {
      return name as HybridWeightPreset
    }
  }
  // Legacy: existing libraries saved from the old slider store non-preset values.
  // Bucket by which side dominates so the UI reflects a plausible current choice.
  if (w.vector >= 0.8) return 'semantic'
  if (w.text >= 0.8) return 'keyword'
  return 'balanced'
}

const PRESET_LABELS: Record<HybridWeightPreset, string> = {
  keyword: 'Keyword',
  balanced: 'Balanced',
  semantic: 'Semantic',
}

const PRESET_TITLES: Record<HybridWeightPreset, string> = {
  keyword:
    'Prioritize exact term matches — better for proper nouns and specific vocabulary',
  balanced: 'Mix keyword and semantic matching evenly',
  semantic:
    'Prioritize meaning over exact words — better for natural-language queries',
}

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

  const handlePresetSelect = (preset: HybridWeightPreset) => {
    onWeightsChange?.(HYBRID_WEIGHT_PRESETS[preset])
  }

  const currentPreset = presetOf(hybridWeights)

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
            absolute inset-x-0 top-0 z-10 rounded-lg border bg-white
            focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20
            ${isDisabled ? 'border-gray-200 bg-gray-100' : 'border-gray-300'}
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
              className="flex-1 min-w-0 bg-transparent outline-none text-gray-900 placeholder-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />

            {hasText && (
              <button
                type="button"
                onClick={handleClear}
                className="shrink-0 h-5 w-5 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Clear search"
              >
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}

            <div className="w-px h-5 bg-gray-200 shrink-0" />

            <button
              type="submit"
              disabled={isDisabled || !hasText}
              className="shrink-0 px-3 py-1 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Ask
            </button>
          </form>

          {showConfig && (
            <div className="grid grid-rows-[0fr] opacity-0 group-focus-within:grid-rows-[1fr] group-focus-within:opacity-100 transition-[grid-template-rows,opacity] duration-200 delay-[150ms] group-focus-within:delay-0">
              <div className="overflow-hidden">
                <div className="border-t border-gray-200 px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap justify-between">
                    <div className="flex items-center gap-2">
                      {onAiModeToggle && (
                        <>
                          <button
                            type="button"
                            onClick={onAiModeToggle}
                            disabled={isDisabled}
                            className={`flex items-center gap-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              isAiMode
                                ? 'text-blue-600'
                                : 'text-gray-400 hover:text-gray-600'
                            }`}
                          >
                            <svg
                              className="h-3 w-3"
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
                            AI answer
                          </button>
                          {isAiMode &&
                            llmMaxTokens !== undefined &&
                            onLlmMaxTokensChange && (
                              <select
                                value={llmMaxTokens}
                                onChange={(e) =>
                                  onLlmMaxTokensChange(Number(e.target.value))
                                }
                                disabled={isDisabled}
                                className="text-xs text-gray-600 bg-white border border-gray-200 rounded px-1 py-0.5 outline-none focus:border-blue-500 disabled:opacity-50"
                              >
                                <option value={256}>Short</option>
                                <option value={512}>Default</option>
                                <option value={1024}>Large</option>
                              </select>
                            )}
                          <div className="w-px h-4 bg-gray-200 mx-1" />
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {showWeights && (
                        <div
                          role="radiogroup"
                          aria-label="Search matching mode"
                          className="inline-flex rounded-md border border-gray-200 overflow-hidden"
                        >
                          {(
                            Object.keys(
                              HYBRID_WEIGHT_PRESETS,
                            ) as HybridWeightPreset[]
                          ).map((preset) => {
                            const active = currentPreset === preset
                            return (
                              <button
                                key={preset}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                title={PRESET_TITLES[preset]}
                                onClick={() => handlePresetSelect(preset)}
                                disabled={isDisabled}
                                className={`px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                  active
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-white text-gray-600 hover:bg-gray-50'
                                }`}
                              >
                                {PRESET_LABELS[preset]}
                              </button>
                            )
                          })}
                        </div>
                      )}

                      {maxResults !== undefined && onMaxResultsChange && (
                        <>
                          <div className="w-px h-4 bg-gray-200 mx-1" />
                          <span className="text-xs text-gray-500 whitespace-nowrap">
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
                            className="w-12 text-xs text-center border border-gray-200 rounded px-1 py-0.5 outline-none focus:border-blue-500 disabled:opacity-50 text-black"
                          />
                        </>
                      )}

                      {minScore !== undefined && onMinScoreChange && (
                        <>
                          <div className="w-px h-4 bg-gray-200 mx-1" />
                          <span className="text-xs text-gray-500 whitespace-nowrap">
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
                            className="w-12 text-xs text-center border border-gray-200 rounded px-1 py-0.5 outline-none focus:border-blue-500 disabled:opacity-50 text-black"
                          />
                          <span className="text-xs text-gray-400">%</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {modelStatus === 'loading' && (
        <p className="mt-2 text-sm text-yellow-600">
          Loading embedding model... Search will be available once the model is
          ready.
        </p>
      )}
      {modelStatus === 'error' && (
        <p className="mt-2 text-sm text-red-600">
          Embedding model failed to load. Search is unavailable.
        </p>
      )}
    </div>
  )
}
