import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { useLibrariesData } from '@/hooks/data/useLibrariesData'
import { useDocumentActions } from '@/hooks/useDocumentActions'
import { Button } from '@/components/ui/Button'
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
      <div className="h-16 flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">Libraries</h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowCreateForm(!showCreateForm)}
          title="Create new library"
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          New
        </Button>
      </div>

      {showCreateForm && (
        <CreateLibraryForm
          onSuccess={handleCreateLibrarySuccess}
          onClose={() => setShowCreateForm(false)}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-4 text-sm text-muted-foreground">Loading libraries...</div>
        )}
        {!loading && libraries.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground text-center">
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
