import { useEffect, useState, useCallback } from 'react'
import {
  Outlet,
  NavLink,
  useParams,
  useNavigate,
  useLocation,
} from 'react-router'
import { useLibrary } from '@/hooks/useLibrary'
import { hasIndex, rebuildIndex } from '@/services/embedding/vector-store'
import { search as searchService } from '@/services/search/search.service'
import { getChunksByLibrary } from '@/services/chunk.service'
import { useDocumentData } from '@/hooks/data/useDocumentData'
import type { SearchResult } from '@/types/search'

interface OpenDocument {
  id: string
  name: string
}

export function LibraryLayout() {
  const { libraryId, documentId } = useParams<{
    libraryId: string
    documentId: string
  }>()
  const { library, loading } = useLibrary(libraryId!)
  const navigate = useNavigate()
  const location = useLocation()

  const [openDocuments, setOpenDocuments] = useState<OpenDocument[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  // Track open document tabs using data hook
  const { document: currentDoc } = useDocumentData(documentId)

  useEffect(() => {
    if (!currentDoc) return

    setOpenDocuments((prev) => {
      const alreadyOpen = prev.some((d) => d.id === currentDoc.id)
      if (alreadyOpen) return prev
      return [...prev, { id: currentDoc.id, name: currentDoc.name }]
    })
  }, [currentDoc])

  const closeDocumentTab = useCallback(
    (docId: string) => {
      setOpenDocuments((prev) => prev.filter((d) => d.id !== docId))
      // If closing the currently viewed document, navigate to documents list
      if (documentId === docId) {
        navigate(`/libraries/${libraryId}/documents`)
      }
    },
    [documentId, libraryId, navigate],
  )

  const performSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim()
      setSearchQuery(query)

      if (!trimmed) {
        setSearchResults([])
        setSearchError(null)
        setHasSearched(false)
        return
      }

      setIsSearching(true)
      setSearchError(null)

      try {
        const results = await searchService(trimmed, libraryId!)
        setSearchResults(results)
        setHasSearched(true)
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : 'Search failed')
        setSearchResults([])
        setHasSearched(true)
      } finally {
        setIsSearching(false)
      }
    },
    [libraryId],
  )

  const clearSearch = useCallback(() => {
    setSearchQuery('')
    setSearchResults([])
    setSearchError(null)
    setHasSearched(false)
  }, [])

  // Rehydrate Orama index if not in memory
  useEffect(() => {
    async function hydrateIndex() {
      if (!libraryId || hasIndex(libraryId)) return
      const chunks = await getChunksByLibrary(libraryId)
      if (chunks.length > 0) {
        await rebuildIndex(libraryId, chunks)
      }
    }
    hydrateIndex()
  }, [libraryId])

  const isDocumentActive = (docId: string) => {
    return location.pathname.includes(`/documents/${docId}`)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">
          {loading ? 'Loading...' : library?.name || 'Library'}
        </h1>
        <nav className="flex gap-1 border-b border-gray-200 overflow-x-auto">
          <NavLink
            to={`/libraries/${libraryId}/documents`}
            end
            className={({ isActive }) =>
              `pb-2 px-3 text-sm font-medium whitespace-nowrap ${
                isActive
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-500 hover:text-gray-900'
              }`
            }
          >
            Documents
          </NavLink>
          <NavLink
            to={`/libraries/${libraryId}/search`}
            className={({ isActive }) =>
              `pb-2 px-3 text-sm font-medium whitespace-nowrap ${
                isActive
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-500 hover:text-gray-900'
              }`
            }
          >
            Search
          </NavLink>
          {openDocuments.map((doc) => (
            <div
              key={doc.id}
              className={`flex items-center gap-1 pb-2 px-3 text-sm font-medium whitespace-nowrap border-b-2 ${
                isDocumentActive(doc.id)
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              <NavLink
                to={`/libraries/${libraryId}/documents/${doc.id}`}
                className="max-w-32 truncate"
              >
                {doc.name}
              </NavLink>
              <button
                onClick={(e) => {
                  e.preventDefault()
                  closeDocumentTab(doc.id)
                }}
                className="ml-1 text-gray-400 hover:text-gray-700 text-xs leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </nav>
      </div>
      <Outlet
        context={{
          searchQuery,
          searchResults,
          isSearching,
          searchError,
          hasSearched,
          performSearch,
          clearSearch,
        }}
      />
    </div>
  )
}
