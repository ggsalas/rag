import { useState, useEffect } from 'react'
import { Button, type ButtonSize, type ButtonVariant  } from '@/components/ui/Button'

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
      variant={confirmDelete ? 'softDanger' : variant}
      size={size}
      onClick={handleClick}
      title={confirmDelete ? 'Click again to confirm' : 'Delete document'}
    >
      {confirmDelete ? '✓ Confirm delete' : '×'}
    </Button>
  )
}
