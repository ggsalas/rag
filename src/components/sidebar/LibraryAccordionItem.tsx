import { ChevronDown } from 'lucide-react'
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
      className="border-b border-border  cursor-pointer"
      onClick={onToggle}
    >
      <div className="flex items-center gap-2 px-3 py-2 group">
        <div className="flex-1 flex items-center justify-between gap-2">
          <span
            className={`truncate flex-1 text-left ${
              isExpanded
                ? 'font-semibold text-foreground'
                : 'font-medium text-muted-foreground group-hover:text-foreground'
            }`}
          >
            {library.name}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
              isExpanded ? '' : '-rotate-90'
            }`}
          />
        </div>
      </div>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div>
            {loading && (
              <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
            )}
            {!loading && documents.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
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
