import { useEffect } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { Toaster } from 'sonner'
import { SidebarLayout } from '@/routes/sidebar-layout'
import { LibraryRedirect } from '@/routes/library-redirect'
import { DocumentsPage } from '@/routes/documents'
import { SearchPage } from '@/routes/search'
import { DocumentViewerPage } from '@/routes/document-viewer'
import { cleanupInterruptedDocuments } from '@/services/document.service'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { useProcessingDocuments } from '@/hooks/useProcessingDocuments'
import { useModelStatus } from '@/hooks/useModelStatus'
import { useProcessingNotifications } from '@/hooks/useProcessingNotifications'

const router = createBrowserRouter(
  [
  {
    path: '/',
    element: <SidebarLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/libraries" replace />,
      },
      {
        path: 'libraries',
        element: <LibraryRedirect />,
      },
      {
        path: 'libraries/:libraryId',
        element: <LibraryRedirect />,
      },
      {
        path: 'libraries/:libraryId/documents',
        element: <DocumentsPage />,
      },
      {
        path: 'libraries/:libraryId/documents/:documentId',
        element: <DocumentViewerPage />,
      },
      {
        path: 'libraries/:libraryId/search',
        element: <SearchPage />,
      },
    ],
  },
  ],
  { basename: import.meta.env.BASE_URL },
)

export function App() {
  const hasProcessingDocuments = useProcessingDocuments()

  // Initialize model status and processing notifications
  useModelStatus()
  useProcessingNotifications()

  // Warn user before leaving if documents are being processed
  useBeforeUnload(
    hasProcessingDocuments,
    'Documents are still being processed. If you leave now, processing will be cancelled.',
  )

  useEffect(() => {
    // Clean up documents that were interrupted during the previous session
    // (browser was closed or refreshed while documents were processing)
    cleanupInterruptedDocuments()
      .then((count) => {
        if (count > 0) {
          console.log(
            `Cleaned up ${count} interrupted document(s) from previous session`,
          )
        }
      })
      .catch((error) => {
        console.error('Failed to cleanup interrupted documents:', error)
      })
  }, [])

  return (
    <>
      <Toaster />
      <RouterProvider router={router} />
    </>
  )
}
