import { exportLibraryCorpus } from '@/dev/corpus/corpus-export.service'
import { db } from '@/infrastructure/db'

/**
 * Dev-only diagnostic tools exposed on `window.__rag` for browser console use.
 *
 * This module is imported conditionally from `main.tsx` only when
 * `import.meta.env.DEV` is true, so it is never included in production builds.
 *
 * Usage from the browser console:
 *
 * ```js
 * // List all libraries with their IDs (needed to export a specific one)
 * await __rag.listLibraries()
 *
 * // Export a full corpus fixture (with embeddings) for a given library ID
 * await __rag.exportCorpus('your-library-id')
 *
 * // Export without embeddings (lightweight, text-only fixture)
 * await __rag.exportCorpus('your-library-id', { includeEmbeddings: false })
 * ```
 *
 * The export triggers a browser download of a JSON file named
 * `rag-corpus-<libraryId>-<date>.json`. Move that file to
 * `src/dev/fixtures/` to use it with the benchmark tests.
 */

type ExportOptions = {
  includeEmbeddings?: boolean
}

async function listLibraries(): Promise<void> {
  const libraries = await db.libraries.toArray()
  if (libraries.length === 0) {
    console.log('[rag] No libraries found in IndexedDB.')
    return
  }
  console.table(
    libraries.map((l) => ({
      id: l.id,
      name: l.name,
      documents: l.documentCount,
      chunks: l.chunkCount,
    })),
  )
}

async function exportCorpus(
  libraryId: string,
  options: ExportOptions = {},
): Promise<void> {
  const { includeEmbeddings = true } = options

  console.log(
    `[rag] Exporting corpus for library "${libraryId}" (embeddings: ${includeEmbeddings ? 'included' : 'omitted'})...`,
  )

  const fixture = await exportLibraryCorpus(libraryId, { includeEmbeddings })

  const json = JSON.stringify(fixture, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const date = new Date().toISOString().slice(0, 10)
  const filename = `rag-corpus-${libraryId}-${date}.json`

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()

  URL.revokeObjectURL(url)

  const docCount = fixture.documents.length
  const chunkCount = fixture.documents.reduce(
    (sum, d) => sum + d.chunks.length,
    0,
  )
  const sizeKb = (blob.size / 1024).toFixed(1)

  console.log(
    `[rag] ✓ Exported ${docCount} documents, ${chunkCount} chunks (${sizeKb} KB) → ${filename}`,
  )
  console.log(
    `[rag] Move the downloaded file to: src/dev/fixtures/`,
  )
}

// Register on window for console access
declare global {
  interface Window {
    __rag: {
      listLibraries: typeof listLibraries
      exportCorpus: typeof exportCorpus
    }
  }
}

export function registerDevTools(): void {
  window.__rag = {
    listLibraries,
    exportCorpus,
  }

  console.log(
    '[rag] Dev tools registered. Use window.__rag.listLibraries() or window.__rag.exportCorpus(libraryId)',
  )
}
