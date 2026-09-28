import { describe, it, expect } from 'vitest'
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  loadCorpusFixture,
  corpusFixtureExists,
  fixtureToBenchmarkChunks,
} from './corpus-fixture.loader'
import type { CorpusFixture } from '@/types/corpus-fixture'

const TMP_DIR = resolve(__dirname, '__fixtures__')
const TMP_FILE = resolve(TMP_DIR, '_test-temp.json')

function writeTmpFixture(data: unknown): void {
  mkdirSync(TMP_DIR, { recursive: true })
  writeFileSync(TMP_FILE, JSON.stringify(data), 'utf-8')
}

function cleanupTmp(): void {
  try {
    unlinkSync(TMP_FILE)
  } catch {
    // Ignore if already removed
  }
}

const VALID_FIXTURE: CorpusFixture = {
  version: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  library: {
    id: 'lib-1',
    name: 'Test Library',
    documentCount: 1,
    chunkCount: 2,
  },
  documents: [
    {
      meta: {
        id: 'doc-1',
        libraryId: 'lib-1',
        name: 'test.pdf',
        type: 'pdf',
        size: 1024,
        createdAt: 1000,
        updatedAt: 2000,
        status: 'indexed',
        chunkCount: 2,
      },
      content: '# Title\n\nBody text.',
      chunks: [
        {
          chunkIndex: 0,
          text: '## Section A\n\nContent A.',
          searchText: 'Section A Content A',
          sectionPath: ['Title', 'Section A'],
          headingText: 'Section A',
        },
        {
          chunkIndex: 1,
          text: '## Section B\n\nContent B.',
          searchText: 'Section B Content B',
          sectionPath: ['Title', 'Section B'],
          headingText: 'Section B',
        },
      ],
    },
  ],
  embeddings: [
    { documentId: 'doc-1', chunkIndex: 0, embedding: [0.1, 0.2, 0.3] },
    { documentId: 'doc-1', chunkIndex: 1, embedding: [0.4, 0.5, 0.6] },
  ],
}

describe('corpus-fixture.loader', () => {
  describe('loadCorpusFixture', () => {
    it('should return null when file does not exist', () => {
      const result = loadCorpusFixture('/nonexistent/path/fixture.json')
      expect(result).toBeNull()
    })

    it('should load and validate a valid fixture', () => {
      writeTmpFixture(VALID_FIXTURE)
      try {
        const result = loadCorpusFixture(TMP_FILE)
        expect(result).not.toBeNull()
        expect(result!.version).toBe(1)
        expect(result!.documents).toHaveLength(1)
        expect(result!.documents[0]!.chunks).toHaveLength(2)
      } finally {
        cleanupTmp()
      }
    })

    it('should throw on invalid fixture content', () => {
      writeTmpFixture({ version: 99 })
      try {
        expect(() => loadCorpusFixture(TMP_FILE)).toThrow(
          'Invalid corpus fixture',
        )
      } finally {
        cleanupTmp()
      }
    })
  })

  describe('corpusFixtureExists', () => {
    it('should return false for missing files', () => {
      expect(corpusFixtureExists('/nonexistent/fixture.json')).toBe(false)
    })

    it('should return true for existing files', () => {
      writeTmpFixture(VALID_FIXTURE)
      try {
        expect(corpusFixtureExists(TMP_FILE)).toBe(true)
      } finally {
        cleanupTmp()
      }
    })
  })

  describe('fixtureToBenchmarkChunks', () => {
    it('should flatten chunks with document context', () => {
      const chunks = fixtureToBenchmarkChunks(VALID_FIXTURE)

      expect(chunks).toHaveLength(2)
      expect(chunks[0]!.chunkId).toBe('doc-1::0')
      expect(chunks[0]!.documentId).toBe('doc-1')
      expect(chunks[0]!.documentName).toBe('test.pdf')
      expect(chunks[0]!.text).toContain('Section A')
      expect(chunks[0]!.searchText).toContain('Section A')
      expect(chunks[1]!.chunkId).toBe('doc-1::1')
    })

    it('should return empty array for fixture with no documents', () => {
      const empty: CorpusFixture = {
        ...VALID_FIXTURE,
        documents: [],
      }
      expect(fixtureToBenchmarkChunks(empty)).toEqual([])
    })
  })
})
