/**
 * Diagnostic: identifies chunks exceeding token limit on raw content.
 * NOTE: Tests chunking size mechanics in isolation. Does NOT represent the
 * production pipeline (normalizeMarkdown → chunkMarkdown).
 */
import { describe, it } from 'vitest'
import { resolve } from 'node:path'
import { chunkMarkdown } from '@/services/ingest/chunking.service'
import {
  CORPUS_FIXTURES_DIR,
  loadCorpusFixture,
  corpusFixtureExists,
} from '@/dev/corpus/corpus-fixture.loader'

const FIXTURE_PATH = resolve(CORPUS_FIXTURES_DIR, 'britnet-corpus.json')

describe.skipIf(!corpusFixtureExists(FIXTURE_PATH))(
  'oversized chunk investigation',
  () => {
    it('identifies chunks exceeding token limit', () => {
      const fixture = loadCorpusFixture(FIXTURE_PATH)!
      const content = fixture.documents[0]!.content
      const chunks = chunkMarkdown(content)

      const CHAR_TOKEN_LIMIT = 256 * 4 // 1024

      const oversized = chunks
        .map((c, i) => ({ index: i, ...c }))
        .filter((c) => c.text.length > CHAR_TOKEN_LIMIT)

      console.log(`\n=== CHUNKS EXCEEDING ${CHAR_TOKEN_LIMIT} CHARS ===`)
      console.log(`Total oversized: ${oversized.length}/${chunks.length}`)

      for (const chunk of oversized) {
        console.log(`\n--- Chunk ${chunk.index} (${chunk.text.length} chars) ---`)
        console.log(`sectionPath: ${chunk.sectionPath.join(' > ')}`)
        console.log(`headingText: ${chunk.headingText}`)
        console.log(`searchText length: ${chunk.searchText.length}`)
        // Show first 300 chars to identify pattern
        console.log(`text preview: ${chunk.text.slice(0, 300)}...`)

        // Check if it's a table
        const isTable = chunk.text.includes('|') && chunk.text.includes('\n|')
        console.log(`contains table syntax: ${isTable}`)

        // Check for code blocks
        const isCode = chunk.text.includes('```')
        console.log(`contains code block: ${isCode}`)
      }
    })
  },
)
