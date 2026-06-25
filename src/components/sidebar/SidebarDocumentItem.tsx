import type { DocumentMeta } from '@/types/document'

interface SidebarDocumentItemProps {
  document: DocumentMeta
  onClick: () => void
  onDelete: () => void
}

export function SidebarDocumentItem({
  document,
  onClick,
}: SidebarDocumentItemProps) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="relative flex flex-col w-full px-3 py-2 hover:bg-gray-100 text-sm group border-t border-gray-200 cursor-pointer"
    >
      <div className="flex-1 grow flex gap-2 text-left min-w-0">
        <span className="truncate text-gray-700 group-hover:text-gray-900">
          {document.name}
        </span>
      </div>

      {document.status !== 'indexed' && document.status !== 'error' && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-200 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${document.processingProgress ?? 0}%` }}
          />
        </div>
      )}
    </div>
  )
}
