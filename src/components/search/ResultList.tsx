import type { SearchResult } from '@/types/search'
import { ResultCard } from './ResultCard'
import { EmptyState } from '@/components/ui/EmptyState'

interface ResultListProps {
  results: SearchResult[]
  isSearching: boolean
  hasSearched: boolean
  error: string | null
}

export function ResultList({ results, isSearching, hasSearched, error }: ResultListProps) {
  // Error state
  if (error) {
    return (
      <EmptyState
        icon={
          <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        }
        title="Search failed"
        description={error}
      />
    )
  }

  // Loading state
  if (isSearching) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3 text-gray-500">
          <svg
            className="animate-spin h-5 w-5 text-blue-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Searching...</span>
        </div>
      </div>
    )
  }

  // Initial state: user hasn't searched yet
  if (!hasSearched) {
    return (
      <EmptyState
        icon={
          <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        }
        title="Search your documents"
        description="Enter a query to find relevant passages across all documents in this library."
      />
    )
  }

  // No results found
  if (results.length === 0) {
    return (
      <EmptyState
        icon={
          <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        }
        title="No results found"
        description="Try a different query or make sure documents have been uploaded and indexed."
      />
    )
  }

  // Results
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        {results.length} {results.length === 1 ? 'result' : 'results'} found
      </p>
      {results.map((result, index) => (
        <ResultCard key={result.chunkId} result={result} rank={index + 1} />
      ))}
    </div>
  )
}
