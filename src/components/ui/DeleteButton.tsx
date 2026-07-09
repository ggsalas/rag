import { useState, useEffect } from 'react'
import { X, Check } from 'lucide-react'
import {
  Button,
  type ButtonSize,
  type ButtonVariant,
} from '@/components/ui/Button'

interface DeleteButtonProps {
  onDelete: () => void
  size?: ButtonSize
  variant: ButtonVariant
}

export function DeleteButton({
  onDelete,
  size = 'xs',
  variant = 'soft',
}: DeleteButtonProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (confirmDelete) {
      const timer = setTimeout(() => setConfirmDelete(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [confirmDelete])

  const handleClick = () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    onDelete()
  }

  return (
    <Button
      variant={confirmDelete ? 'danger' : variant}
      size={size}
      onClick={handleClick}
      title={confirmDelete ? 'Click again to confirm' : 'Delete document'}
    >
      {confirmDelete ? (
        <span className="flex items-center gap-1">
          <Check className="h-4 w-4" /> Confirm delete
        </span>
      ) : (
        <X className="h-4 w-4" />
      )}
    </Button>
  )
}
