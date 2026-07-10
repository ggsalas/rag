import { RouterProvider } from 'react-router'
import { Toaster } from 'sonner'
import { router } from '@/routes'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { useProcessingDocuments } from '@/hooks/useProcessingDocuments'
import { useModelStatus } from '@/hooks/useModelStatus'
import { useProcessingNotifications } from '@/hooks/useProcessingNotifications'
import { useInterruptedDocumentsCleanup } from '@/hooks/useInterruptedDocumentsCleanup'

export function App() {
  const hasProcessingDocuments = useProcessingDocuments()

  useModelStatus()
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
