import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useLibrariesData } from '@/hooks/data/useLibrariesData'
import { useDocumentActions } from '@/hooks/useDocumentActions'
import { CreateLibraryForm } from './CreateLibraryForm'
import { LibraryAccordionItem } from './LibraryAccordionItem'

export function Sidebar() {
  const { libraries, loading } = useLibrariesData()
  const { deleteDocument } = useDocumentActions()
  const navigate = useNavigate()
  const { libraryId: currentLibraryId } = useParams<{ libraryId: string }>()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [expandedLibraryId, setExpandedLibraryId] = useState<string | null>(
    currentLibraryId ?? null,
  )

  const handleToggleLibrary = (libraryId: string) => {
    const isCurrentlyExpanded = expandedLibraryId === libraryId

    if (!isCurrentlyExpanded) {
      setExpandedLibraryId(libraryId)
    }

    navigate(`/libraries/${libraryId}`)
  }

  const handleDocumentClick = (libraryId: string, documentId: string) => {
    navigate(`/libraries/${libraryId}/documents/${documentId}`)
  }

  const handleDocumentDelete = async (documentId: string) => {
    try {
      await deleteDocument(documentId)
    } catch (error) {
      console.error('Failed to delete document:', error)
    }
  }

  const handleCreateLibrarySuccess = (libraryId: string) => {
    setShowCreateForm(false)
    setExpandedLibraryId(libraryId)
    navigate(`/libraries/${libraryId}`)
  }

  return (
    <>
      <div className="h-16 flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Libraries</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          title="Create new library"
        >
          + New
        </button>
      </div>

      {showCreateForm && (
        <CreateLibraryForm
          onSuccess={handleCreateLibrarySuccess}
          onClose={() => setShowCreateForm(false)}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-4 text-sm text-gray-500">Loading libraries...</div>
        )}
        {!loading && libraries.length === 0 && (
          <div className="p-4 text-sm text-gray-500 text-center">
            No libraries yet. Create one to get started!
          </div>
        )}
        {!loading &&
          libraries.map((library) => (
            <LibraryAccordionItem
              key={library.id}
              library={library}
              isExpanded={expandedLibraryId === library.id}
              onToggle={() => handleToggleLibrary(library.id)}
              onDocumentClick={(documentId) =>
                handleDocumentClick(library.id, documentId)
              }
              onDocumentDelete={handleDocumentDelete}
            />
          ))}
      </div>
    </>
  )
}
