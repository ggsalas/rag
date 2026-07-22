import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useProcessingCountData } from '@/hooks/data/useProcessingCountData'

const TOAST_ID = 'processing-queue'

/** Hook that shows toast notifications for document processing queue */
export function useProcessingNotifications() {
  const { count } = useProcessingCountData()
  const prevCountRef = useRef(0)

  useEffect(() => {
    const prevCount = prevCountRef.current
    prevCountRef.current = count

    if (count > 0) {
      toast.loading(`Processing ${count} document${count !== 1 ? 's' : ''}...`, {
        id: TOAST_ID,
      })
    } else if (prevCount > 0 && count === 0) {
      toast.success('All documents indexed', { id: TOAST_ID, duration: 3000 })
    }
  }, [count])
}
