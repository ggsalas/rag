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
      className="relative flex flex-col w-full px-3 py-2 text-sm group border-t border-border cursor-pointer"
    >
      <div className="flex-1 grow flex gap-2 text-left min-w-0">
        <span className="truncate text-muted-foreground group-hover:text-foreground">
          {document.name}
        </span>
      </div>

      {document.status !== 'indexed' && document.status !== 'error' && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-secondary overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${document.processingProgress ?? 0}%` }}
          />
        </div>
      )}
    </div>
  )
}
