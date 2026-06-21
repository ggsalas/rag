import { useEffect } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { RootLayout } from '@/routes/root'
import { LibrariesPage } from '@/routes/libraries'
import { LibraryLayout } from '@/routes/library-layout'
import { DocumentsPage } from '@/routes/documents'
import { SearchPage } from '@/routes/search'
import { DocumentViewerPage } from '@/routes/document-viewer'
import { cleanupInterruptedDocuments } from '@/services/document.service'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { useProcessingDocuments } from '@/hooks/useProcessingDocuments'

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/libraries" replace />,
      },
      {
        path: 'libraries',
        element: <LibrariesPage />,
      },
      {
        path: 'libraries/:libraryId',
        element: <LibraryLayout />,
        children: [
          {
            index: true,
            element: <Navigate to="documents" replace />,
          },
          {
            path: 'documents',
            element: <DocumentsPage />,
          },
          {
            path: 'documents/:documentId',
            element: <DocumentViewerPage />,
          },
          {
            path: 'search',
            element: <SearchPage />,
          },
        ],
      },
    ],
  },
])

export function App() {
  const hasProcessingDocuments = useProcessingDocuments()

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

  return <RouterProvider router={router} />
}
