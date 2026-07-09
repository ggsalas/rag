import { useState, useCallback, useRef, type DragEvent } from 'react'
import { CloudUpload } from 'lucide-react'
import { Button } from '@/components/ui/Button'

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
]

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md']

interface DropZoneProps {
  onFiles: (files: File[]) => void
  disabled?: boolean
  className?: string
}

export function DropZone({ onFiles, disabled = false, className }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isValidFile = (file: File): boolean => {
    if (ACCEPTED_TYPES.includes(file.type)) return true
    return ACCEPTED_EXTENSIONS.some((ext) =>
      file.name.toLowerCase().endsWith(ext),
    )
  }

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || disabled) return
      const valid = Array.from(fileList).filter(isValidFile)
      if (valid.length > 0) onFiles(valid)
    },
    [onFiles, disabled],
  )

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    if (!disabled) setIsDragOver(true)
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        border-2 border-dashed rounded-lg p-8 text-center transition-colors flex flex-col items-center justify-center
        ${isDragOver ? 'border-ring bg-muted' : 'border-input hover:border-input'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className ?? ''}
      `}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(',')}
        onChange={(e) => handleFiles(e.target.files)}
      />

      <CloudUpload
        className="mx-auto h-12 w-12 text-muted-foreground mb-4"
        strokeWidth={1.5}
      />

      <p className="text-muted-foreground mb-2">
        {isDragOver ? 'Drop files here' : 'Drag & drop documents here'}
      </p>
      <p className="text-sm text-muted-foreground mb-4">
        or click to browse — PDF, DOCX, TXT, MD
      </p>
      <Button
        variant="primary"
        size="sm"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          inputRef.current?.click()
        }}
      >
        Choose Files
      </Button>
    </div>
  )
}
