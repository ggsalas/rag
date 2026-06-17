import { useState, useCallback, useRef, useEffect, type FormEvent } from 'react'
import type { ModelStatus } from '@/store/app.store'

interface SearchBarProps {
  onSearch: (query: string) => void
  isSearching: boolean
  modelStatus: ModelStatus
  initialQuery?: string
}

export function SearchBar({ onSearch, isSearching, modelStatus, initialQuery = '' }: SearchBarProps) {
  const [inputValue, setInputValue] = useState(initialQuery)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Clean up debounce timer
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const debouncedSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onSearch(value)
      }, 300)
    },
    [onSearch]
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

  const isDisabled = modelStatus !== 'ready'

  return (
    <form onSubmit={handleSubmit} className="relative">
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
        className={`
          w-full rounded-lg border px-4 py-3 pr-10
          text-gray-900 placeholder-gray-500
          focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20
          disabled:opacity-50 disabled:cursor-not-allowed
          ${isDisabled ? 'bg-gray-100 border-gray-200' : 'bg-white border-gray-300'}
        `}
      />

      {/* Loading spinner or search icon */}
      <div className="absolute inset-y-0 right-0 flex items-center pr-3">
        {isSearching ? (
          <svg
            className="animate-spin h-5 w-5 text-blue-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <svg
            className="h-5 w-5 text-gray-400"
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
      </div>

      {/* Model status message */}
      {modelStatus === 'loading' && (
        <p className="mt-2 text-sm text-yellow-600">
          Loading embedding model... Search will be available once the model is ready.
        </p>
      )}
      {modelStatus === 'error' && (
        <p className="mt-2 text-sm text-red-600">
          Embedding model failed to load. Search is unavailable.
        </p>
      )}
    </form>
  )
}
