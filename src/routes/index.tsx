import { createBrowserRouter, Navigate } from 'react-router'
import { SidebarLayout } from '@/routes/layouts/sidebar-layout'
import { LibraryRedirect } from '@/routes/pages/library-redirect'
import { DocumentsPage } from '@/routes/pages/documents'
import {
  SearchPage,
  searchLoader,
  searchShouldRevalidate,
} from '@/routes/pages/search'
import { DocumentViewerPage } from '@/routes/pages/document-viewer'

export const router = createBrowserRouter(
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
          loader: searchLoader,
          shouldRevalidate: searchShouldRevalidate,
          element: <SearchPage />,
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
)
