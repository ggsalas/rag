import { useState, type FormEvent } from 'react'
import { useLibraryActions } from '@/hooks/useLibraryActions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

interface CreateLibraryFormProps {
  onSuccess: (id: string) => void
  onClose: () => void
}

export function CreateLibraryForm({
  onSuccess,
  onClose,
}: CreateLibraryFormProps) {
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { createLibrary } = useLibraryActions()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName || isSubmitting) return

    setIsSubmitting(true)
    try {
      const library = await createLibrary(trimmedName)
      setName('')
      onSuccess(library.id)
    } catch (error) {
      console.error('Failed to create library:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-3 border-b border-border">
      <div className="flex flex-col gap-2">
        <Input
          type="text"
          size="sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Library name"
          className="flex-1"
          disabled={isSubmitting}
          autoFocus
        />

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!name.trim()}
            loading={isSubmitting}
          >
            Create
          </Button>
        </div>
      </div>
    </form>
  )
}
