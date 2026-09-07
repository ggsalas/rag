import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocumentViewerHeader } from './DocumentViewerHeader'
import type { DocumentMeta } from '@/types/document'

// Mock react-router's Link component
vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const mockDocument: DocumentMeta = {
  id: 'doc-1',
  libraryId: 'lib-1',
  name: 'Test Document',
  type: 'pdf',
  size: 1024,
  status: 'indexed',
  chunkCount: 5,
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

describe('DocumentViewerHeader', () => {
  it('renders document info correctly', () => {
    render(
      <DocumentViewerHeader
        document={mockDocument}
        backToSearchUrl="/libraries/lib-1/search"
        highlightChunkIndex={null}
        onNavigateChunk={() => {}}
        onDelete={() => {}}
      />,
    )

    expect(screen.getByText('Test Document')).toBeInTheDocument()
    expect(screen.getByText('Type: PDF')).toBeInTheDocument()
    expect(screen.getByText('Size: 1.00 KB')).toBeInTheDocument()
    expect(screen.getByText('Chunks: 5')).toBeInTheDocument()
    expect(screen.getByText('indexed')).toBeInTheDocument()
  })

  it('renders chunk inspector toggle button when callback provided', () => {
    render(
      <DocumentViewerHeader
        document={mockDocument}
        backToSearchUrl="/libraries/lib-1/search"
        highlightChunkIndex={null}
        onNavigateChunk={() => {}}
        onDelete={() => {}}
        onToggleChunkInspector={() => {}}
      />,
    )

    expect(screen.getByText('Chunk txt/md')).toBeInTheDocument()
  })

  it('enables chunk inspector toggle when document has chunks', () => {
    render(
      <DocumentViewerHeader
        document={mockDocument}
        backToSearchUrl="/libraries/lib-1/search"
        highlightChunkIndex={null}
        onNavigateChunk={() => {}}
        onDelete={() => {}}
        onToggleChunkInspector={() => {}}
      />,
    )

    const toggleButton = screen.getByText('Chunk txt/md')
    expect(toggleButton).toBeEnabled()
  })

  it('disables chunk inspector toggle when document has no chunks', () => {
    render(
      <DocumentViewerHeader
        document={{ ...mockDocument, chunkCount: 0 }}
        backToSearchUrl="/libraries/lib-1/search"
        highlightChunkIndex={null}
        onNavigateChunk={() => {}}
        onDelete={() => {}}
        onToggleChunkInspector={() => {}}
      />,
    )

    const toggleButton = screen.getByText('Chunk txt/md')
    expect(toggleButton).toBeDisabled()
  })

  it('calls toggle callback when clicked', () => {
    const onToggle = vi.fn()
    render(
      <DocumentViewerHeader
        document={mockDocument}
        backToSearchUrl="/libraries/lib-1/search"
        highlightChunkIndex={2}
        onNavigateChunk={() => {}}
        onDelete={() => {}}
        onToggleChunkInspector={onToggle}
      />,
    )

    const toggleButton = screen.getByText('Chunk txt/md')
    fireEvent.click(toggleButton)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('shows active state when inspector is enabled', () => {
    render(
      <DocumentViewerHeader
        document={mockDocument}
        backToSearchUrl="/libraries/lib-1/search"
        highlightChunkIndex={2}
        onNavigateChunk={() => {}}
        onDelete={() => {}}
        showChunkInspector={true}
        onToggleChunkInspector={() => {}}
      />,
    )

    const toggleButton = screen.getByText('Chunk txt/md')
    // Button should have active styling (foreground background)
    expect(toggleButton.className).toContain('bg-foreground')
  })

  it('does not render chunk inspector toggle when callback not provided', () => {
    render(
      <DocumentViewerHeader
        document={mockDocument}
        backToSearchUrl="/libraries/lib-1/search"
        highlightChunkIndex={2}
        onNavigateChunk={() => {}}
        onDelete={() => {}}
      />,
    )

    expect(screen.queryByText('Chunk txt/md')).not.toBeInTheDocument()
  })

  it('disables previous chunk button when at first chunk', () => {
    render(
      <DocumentViewerHeader
        document={mockDocument}
        backToSearchUrl="/libraries/lib-1/search"
        highlightChunkIndex={0}
        onNavigateChunk={() => {}}
        onDelete={() => {}}
      />,
    )

    const prevButton = screen.getByTitle('Previous chunk')
    expect(prevButton).toBeDisabled()
  })

  it('disables next chunk button when at last chunk', () => {
    render(
      <DocumentViewerHeader
        document={mockDocument}
        backToSearchUrl="/libraries/lib-1/search"
        highlightChunkIndex={4} // Last chunk (chunkCount is 5)
        onNavigateChunk={() => {}}
        onDelete={() => {}}
      />,
    )

    const nextButton = screen.getByTitle('Next chunk')
    expect(nextButton).toBeDisabled()
  })
})
