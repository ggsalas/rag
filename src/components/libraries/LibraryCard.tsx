import { Link } from 'react-router'
import { useState } from 'react'
import type { Library } from '@/types/library'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/Button'

interface LibraryCardProps {
  library: Library
  onDelete: (id: string) => void
}

export function LibraryCard({ library, onDelete }: LibraryCardProps) {
  const [showConfirm, setShowConfirm] = useState(false)

  const handleDelete = async () => {
    await onDelete(library.id)
    setShowConfirm(false)
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
      <Link to={`/libraries/${library.id}/documents`} className="block group">
        <h3 className="text-xl font-semibold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">
          {library.name}
        </h3>
        {library.description && (
          <p className="text-gray-600 mb-4 line-clamp-2">
            {library.description}
          </p>
        )}
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{library.documentCount} documents</span>
          <span>{formatDate(library.createdAt)}</span>
        </div>
      </Link>

      <div className="mt-4 pt-4 border-t flex justify-end">
        {!showConfirm ? (
          <Button
            variant="danger"
            size="sm"
            onClick={() => setShowConfirm(true)}
          >
            Delete
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowConfirm(false)}
            >
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleDelete}>
              Confirm Delete
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
