import { RouterProvider } from 'react-router'
import { Toaster, toast } from 'sonner'
import { router } from '@/routes'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { useProcessingDocuments } from '@/hooks/useProcessingDocuments'
import { useEmbeddingStatus, type EmbeddingLoadCallbacks } from '@/hooks/useEmbeddingStatus'
import { useProcessingNotifications } from '@/hooks/useProcessingNotifications'
import { useInterruptedDocumentsCleanup } from '@/hooks/useInterruptedDocumentsCleanup'
import { ModelDownloadToast } from '@/components/search/ModelDownloadToast'
import { useMemo } from 'react'

const EMBEDDING_TOAST_ID = 'model-status'

export function App() {
  const hasProcessingDocuments = useProcessingDocuments()

  const embeddingCallbacks = useMemo<EmbeddingLoadCallbacks>(() => ({
    onLoadStart: () => toast(<ModelDownloadToast model="embedding" />, { id: EMBEDDING_TOAST_ID, duration: Infinity }),
    onLoadEnd: () => setTimeout(() => toast.dismiss(EMBEDDING_TOAST_ID), 2000),
    onLoadError: (msg) => toast.error(msg, { id: EMBEDDING_TOAST_ID, duration: Infinity, closeButton: true }),
  }), [])

  useEmbeddingStatus(embeddingCallbacks)
  useProcessingNotifications()
  useInterruptedDocumentsCleanup()
  useBeforeUnload(
    hasProcessingDocuments,
    'Documents are still being processed. If you leave now, processing will be cancelled.',
  )

  return (
    <>
      <Toaster
        expand
        theme="system"
        toastOptions={{
          style: {
            boxShadow: 'none',
            background: 'var(--color-background)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-foreground)',
          },
        }}
      />
      <RouterProvider router={router} />
    </>
  )
}
