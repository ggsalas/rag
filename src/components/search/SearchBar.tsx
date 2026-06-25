import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type FormEvent,
  type ChangeEvent,
} from 'react'
import type { ModelStatus } from '@/store/app.store'
import type { HybridWeights } from '@/types/search'

interface SearchBarProps {
  onSearch: (query: string) => void
  isSearching: boolean
  modelStatus: ModelStatus
  initialQuery?: string
  hybridWeights?: HybridWeights
  onWeightsChange?: (weights: HybridWeights) => void
  notFocused?: boolean
}

export function SearchBar({
  onSearch,
  modelStatus,
  initialQuery = '',
  hybridWeights,
  onWeightsChange,
  notFocused,
}: SearchBarProps) {
  const [inputValue, setInputValue] = useState(initialQuery)
  const [localWeight, setLocalWeight] = useState(hybridWeights?.vector ?? 0.5)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!notFocused) {
      inputRef.current?.focus()
    }
  }, [notFocused])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    if (hybridWeights !== undefined) setLocalWeight(hybridWeights.vector)
  }, [hybridWeights?.vector])

  const debouncedSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => onSearch(value), 300)
    },
    [onSearch],
  )

  const handleChange = (value: string) => {
    setInputValue(value)
    debouncedSearch(value)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (debounceRef.current) clearTimeout(debounceRef.current)
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
  const hasActiveSearch = inputValue.trim().length > 0
  const showWeights =
    hybridWeights !== undefined && onWeightsChange !== undefined

  return (
    <div>
      <div className="group relative">
        {/*
          Invisible placeholder: same padding as the input row, stays in normal
          flow so content below is anchored to input height only — never shifts.
        */}
        <div
          className="invisible pointer-events-none select-none border border-transparent px-4 py-3 text-base"
          aria-hidden="true"
        >
          &nbsp;
        </div>

        {/*
          Actual search box: absolutely positioned over the placeholder.
          Expands downward on focus (slider appears inside the border),
          covering content below — intentional overlay, no layout shift.
        */}
        <div
          className={`
            absolute inset-x-0 top-0 z-10 rounded-lg border bg-white
            focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20
            ${isDisabled ? 'border-gray-200 bg-gray-100' : 'border-gray-300'}
          `}
        >
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 px-4 py-3"
          >
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={
                isDisabled
                  ? 'Waiting for embedding model to load...'
                  : 'Search your documents...'
              }
              disabled={isDisabled}
              className="flex-1 min-w-0 bg-transparent outline-none text-gray-900 placeholder-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />

            {hasActiveSearch ? (
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
            ) : (
              <svg
                className="shrink-0 h-5 w-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            )}
          </form>

          {showWeights && (
            <div className="grid grid-rows-[0fr] opacity-0 group-focus-within:grid-rows-[1fr] group-focus-within:opacity-100 transition-[grid-template-rows,opacity] duration-200 delay-[150ms] group-focus-within:delay-0">
              <div className="overflow-hidden">
                <div className="border-t border-gray-200 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 whitespace-nowrap">
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
                      className="flex-1 h-1.5 accent-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      Semantic
                    </span>
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
