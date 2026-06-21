import { useState } from 'react'
import { useLibraries } from '@/hooks/useLibraries'
import { LibraryCard } from '@/components/libraries/LibraryCard'
import { CreateLibraryModal } from '@/components/libraries/CreateLibraryModal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'

export function LibrariesPage() {
  const { libraries, loading, createLibrary, deleteLibrary } = useLibraries()
  const [showCreateModal, setShowCreateModal] = useState(false)

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Libraries</h1>
        <Button onClick={() => setShowCreateModal(true)}>New Library</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-gray-500">Loading libraries...</p>
        </div>
      ) : libraries.length === 0 ? (
        <EmptyState
          icon={
            <svg
              className="w-16 h-16"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
          }
          title="No libraries yet"
          description="Create your first library to start organizing and searching documents."
          action={
            <Button onClick={() => setShowCreateModal(true)}>
              Create Library
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {libraries.map((library) => (
            <LibraryCard
              key={library.id}
              library={library}
              onDelete={deleteLibrary}
            />
          ))}
        </div>
      )}

      <CreateLibraryModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={createLibrary}
      />
    </div>
  )
}
