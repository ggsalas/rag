import { useOutletContext } from 'react-router'
import { useAppStore } from '@/store/app.store'
import { SearchBar } from '@/components/search/SearchBar'
import { ResultList } from '@/components/search/ResultList'
import type { SearchResult } from '@/types/search'

interface SearchContext {
  searchQuery: string
  searchResults: SearchResult[]
  isSearching: boolean
  searchError: string | null
  hasSearched: boolean
  performSearch: (query: string) => Promise<void>
  clearSearch: () => void
}

export function SearchPage() {
  const {
    searchResults,
    isSearching,
    searchError,
    hasSearched,
    performSearch,
  } = useOutletContext<SearchContext>()
  const modelStatus = useAppStore((s) => s.modelStatus)

  return (
    <div>
      <SearchBar
        onSearch={performSearch}
        isSearching={isSearching}
        modelStatus={modelStatus}
      />

      <div className="mt-6">
        <ResultList
          results={searchResults}
          isSearching={isSearching}
          hasSearched={hasSearched}
          error={searchError}
        />
      </div>
    </div>
  )
}
