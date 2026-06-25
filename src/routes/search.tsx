import { useParams, useSearchParams, useLocation } from 'react-router'
import { useAppStore } from '@/store/app.store'
import { useSearch } from '@/hooks/useSearch'
import { useOramaHydration } from '@/hooks/useOramaHydration'
import { SearchBar } from '@/components/search/SearchBar'
import { ResultList } from '@/components/search/ResultList'
import { MainPanel } from '@/components/sidebar/MainPanel'

export function SearchPage() {
  const { libraryId } = useParams<{ libraryId: string }>()
  const modelStatus = useAppStore((s) => s.modelStatus)
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()

  useOramaHydration(libraryId)

  // Get initial query and focused result from location state (when returning from document viewer)
  const locationState = location.state as {
    searchQuery?: string
    focusedChunkId?: string | null
  } | null
  const stateQuery = locationState?.searchQuery
  const initialQuery = searchParams.get('q') || stateQuery || ''
  const focusedChunkId = locationState?.focusedChunkId

  const {
    results,
    isSearching,
    error,
    hasSearched,
    search: performSearch,
    hybridWeights,
    setHybridWeights,
  } = useSearch(libraryId!, initialQuery)

  // Wrapper to update URL when searching
  const handleSearch = (query: string) => {
    performSearch(query)

    // Update URL search params
    if (query.trim()) {
      setSearchParams({ q: query })
    } else {
      setSearchParams({})
    }
  }

  return (
    <MainPanel>
      <div className="flex-1 overflow-y-auto p-6">
        <SearchBar
          onSearch={handleSearch}
          isSearching={isSearching}
          modelStatus={modelStatus}
          initialQuery={initialQuery}
          hybridWeights={hybridWeights}
          onWeightsChange={setHybridWeights}
          notFocused={!!focusedChunkId}
        />
        <div className="mt-6">
          <ResultList
            results={results}
            isSearching={isSearching}
            hasSearched={hasSearched}
            error={error}
            focusedChunkId={focusedChunkId}
          />
        </div>
      </div>
    </MainPanel>
  )
}
