import { useParams } from 'react-router'
import { useSearch } from '@/hooks/useSearch'
import { useAppStore } from '@/store/app.store'
import { SearchBar } from '@/components/search/SearchBar'
import { ResultList } from '@/components/search/ResultList'

export function SearchPage() {
  const { libraryId } = useParams<{ libraryId: string }>()
  const modelStatus = useAppStore((s) => s.modelStatus)
  const { results, isSearching, error, hasSearched, search } = useSearch(libraryId!)

  return (
    <div>
      <SearchBar
        onSearch={search}
        isSearching={isSearching}
        modelStatus={modelStatus}
      />

      <div className="mt-6">
        <ResultList
          results={results}
          isSearching={isSearching}
          hasSearched={hasSearched}
          error={error}
        />
      </div>
    </div>
  )
}
