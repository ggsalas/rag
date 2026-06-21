import { useOutletContext } from 'react-router'
import { useAppStore } from '@/store/app.store'
import { SearchBar } from '@/components/search/SearchBar'
import { ResultList } from '@/components/search/ResultList'
import { HybridWeightsControl } from '@/components/search/HybridWeightsControl'
import type { SearchResult, HybridWeights } from '@/types/search'

interface SearchContext {
  searchQuery: string
  searchResults: SearchResult[]
  isSearching: boolean
  searchError: string | null
  hasSearched: boolean
  performSearch: (query: string) => Promise<void>
  clearSearch: () => void
  hybridWeights: HybridWeights
  setHybridWeights: (weights: HybridWeights) => void
}

export function SearchPage() {
  const {
    searchResults,
    isSearching,
    searchError,
    hasSearched,
    performSearch,
    hybridWeights,
    setHybridWeights,
  } = useOutletContext<SearchContext>()
  const modelStatus = useAppStore((s) => s.modelStatus)

  return (
    <div>
      <SearchBar
        onSearch={performSearch}
        isSearching={isSearching}
        modelStatus={modelStatus}
      />

      <div className="mt-4">
        <HybridWeightsControl
          weights={hybridWeights}
          onChange={setHybridWeights}
          disabled={isSearching || modelStatus !== 'ready'}
        />
      </div>

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
