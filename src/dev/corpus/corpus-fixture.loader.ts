import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  CorpusFixture,
  CorpusFixtureChunk,
} from '@/types/corpus-fixture'
import { validateCorpusFixture } from './corpus-export.service'

/**
 * Default location for corpus fixtures, relative to the project root.
 *
 * Tests import from here; the dev console export downloads to the user's
 * Downloads folder and they move it here manually.
 */
export const CORPUS_FIXTURES_DIR = resolve(__dirname, '..', 'fixtures')

/**
 * Loads a corpus fixture JSON file from disk and validates its shape.
 *
 * Returns the parsed fixture on success, or `null` if the file does not exist.
 * Throws if the file exists but fails validation — that signals a corrupt or
 * incompatible fixture that the user should fix, not silently skip.
 *
 * This is intentionally a Node-only helper (uses `fs`). It is meant for Vitest
 * tests and benchmark scripts, not for browser code.
 */
export function loadCorpusFixture(fixturePath: string): CorpusFixture | null {
  if (!existsSync(fixturePath)) return null

  const raw = readFileSync(fixturePath, 'utf-8')
  const parsed: unknown = JSON.parse(raw)

  const error = validateCorpusFixture(parsed)
  if (error) {
    throw new Error(`Invalid corpus fixture at ${fixturePath}: ${error}`)
  }

  return parsed as CorpusFixture
}

/**
 * Returns true if a corpus fixture file exists at the given path.
 *
 * Use this to guard `describe.skipIf(...)` blocks so tests degrade gracefully
 * when the fixture is not present (e.g. in CI or fresh clones).
 */
export function corpusFixtureExists(fixturePath: string): boolean {
  return existsSync(fixturePath)
}

/**
 * Flattens all chunks from a fixture into an array of benchmark-ready objects.
 *
 * Each entry carries the parent document ID and name alongside the chunk data
 * so consumers can trace results back to the source document. The shape is
 * intentionally compatible with `BenchmarkChunk` from search-benchmark.types
 * (chunkId, text, searchText) plus extras for diagnostics.
 */
export function fixtureToBenchmarkChunks(
  fixture: CorpusFixture,
): Array<
  CorpusFixtureChunk & {
    chunkId: string
    documentId: string
    documentName: string
  }
> {
  const result: Array<
    CorpusFixtureChunk & {
      chunkId: string
      documentId: string
      documentName: string
    }
  > = []

  for (const doc of fixture.documents) {
    for (const chunk of doc.chunks) {
      result.push({
        ...chunk,
        // Synthetic stable ID: documentId + chunkIndex. The original chunk.id
        // is not stored in the fixture chunks section (only in embeddings) to
        // keep the fixture focused on content. Benchmarks need a unique ID for
        // dedup and MRR calculation.
        chunkId: `${doc.meta.id}::${chunk.chunkIndex}`,
        documentId: doc.meta.id,
        documentName: doc.meta.name,
      })
    }
  }

  return result
}
