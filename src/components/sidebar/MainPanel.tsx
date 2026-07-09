import { useState, type FormEvent, type ReactNode } from 'react'
import { useParams, Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useLibraryData } from '@/hooks/data/useLibraryData'
import { useLibraryActions } from '@/hooks/useLibraryActions'
import { Button, buttonClasses } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { DeleteButton } from '@/components/ui/DeleteButton'

interface MainPanelProps {
  children: ReactNode
  noAddDocment?: boolean
}

/**
 * Main panel wrapper that resolves library before rendering content.
 * Shows loading state while resolving, error if library not found.
 */
export function MainPanel({ children, noAddDocment }: MainPanelProps) {
  const { libraryId } = useParams<{ libraryId: string }>()
  const library = useLibraryData(libraryId)
  const { deleteLibrary, renameLibrary } = useLibraryActions()
  const navigate = useNavigate()
  const [isEditing, setIsEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)

  const startEditing = () => {
    setNameDraft(library?.name ?? '')
    setIsEditing(true)
  }

  const handleRename = async (e: FormEvent) => {
    e.preventDefault()
    if (!libraryId) return
    const trimmedName = nameDraft.trim()
    if (!trimmedName || trimmedName === library?.name) {
      setIsEditing(false)
      return
    }

    setIsRenaming(true)
    try {
      await renameLibrary(libraryId, trimmedName)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to rename library:', error)
      toast.error('Failed to rename library')
    } finally {
      setIsRenaming(false)
    }
  }

  const handleDeleteLibrary = async () => {
    if (!libraryId) return
    try {
      await deleteLibrary(libraryId)
      toast.success('Library deleted')
      navigate('/libraries')
    } catch (error) {
      console.error('Failed to delete library:', error)
      toast.error('Failed to delete library')
    }
  }

  // Loading state: blank screen (undefined = useLiveQuery still querying)
  if (library === undefined) {
    return null
  }

  // Error state: library not found (null = query finished, no result)
  if (library === null || !libraryId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-foreground font-medium">Library not found</p>
          <Link
            to="/libraries"
            className="text-foreground hover:underline text-sm mt-2 inline-block"
          >
            ← Back to libraries
          </Link>
        </div>
      </div>
    )
  }

  // Success: render header + children
  return (
    <>
      <header className="h-16 border-b border-border bg-background px-6 py-4 flex items-center justify-between">
        <div>
          {isEditing ? (
            <form onSubmit={handleRename} className="flex items-center gap-2">
              <Input
                type="text"
                size="sm"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setIsEditing(false)}
                disabled={isRenaming}
                autoFocus
                className="font-semibold"
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!nameDraft.trim()}
                loading={isRenaming}
              >
                Rename
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={isRenaming}
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">
                {library.name}
              </h1>
              <Button
                variant="ghost"
                size="xs"
                onClick={startEditing}
                title="Rename library"
                aria-label="Rename library"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"
                  />
                </svg>
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          {!noAddDocment && (
            <Link
              to={`/libraries/${libraryId}/documents`}
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            >
              + Add Documents
            </Link>
          )}

          <DeleteButton
            onDelete={handleDeleteLibrary}
            size="sm"
            variant="ghost"
          />
        </div>
      </header>
      {children}
    </>
  )
}
