import type { Library } from '@/types/library'
import { useDocumentsData } from '@/hooks/data/useDocumentsData'
import { SidebarDocumentItem } from './SidebarDocumentItem'

interface LibraryAccordionItemProps {
  library: Library
  isExpanded: boolean
  onToggle: () => void
  onDocumentClick: (documentId: string) => void
  onDocumentDelete: (documentId: string) => void
}

export function LibraryAccordionItem({
  library,
  isExpanded,
  onToggle,
  onDocumentClick,
  onDocumentDelete,
}: LibraryAccordionItemProps) {
  const { documents, loading } = useDocumentsData(library.id)

  return (
    <div
      className="border-b border-gray-200  cursor-pointer"
      onClick={onToggle}
    >
      <div
        className={`flex items-center gap-2 px-3 py-2 hover:bg-gray-100 ${isExpanded ? 'bg-gray-50' : ''}`}
      >
        <div className="flex-1 flex items-center justify-between gap-2">
          <span className="font-medium text-gray-900 truncate flex-1 text-left">
            {library.name}
          </span>
          <span className="text-gray-400 text-sm">
            {isExpanded ? '▼' : '▲'}
          </span>
        </div>
      </div>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="bg-gray-50">
            {loading && (
              <div className="px-3 py-2 text-sm text-gray-500">Loading...</div>
            )}
            {!loading && documents.length === 0 && (
              <div className="px-3 py-2 text-sm text-gray-500">
                No documents yet
              </div>
            )}
            {!loading &&
              documents.map((doc) => (
                <SidebarDocumentItem
                  key={doc.id}
                  document={doc}
                  onClick={() => onDocumentClick(doc.id)}
                  onDelete={() => onDocumentDelete(doc.id)}
                />
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}
