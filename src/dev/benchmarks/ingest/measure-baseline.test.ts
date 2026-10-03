/**
 * Diagnostic: measures chunking mechanics on raw content.
 * NOTE: This tests the chunking algorithm in isolation (link integrity, offset
 * tracking, size distribution). It does NOT represent the production pipeline,
 * which normalizes Markdown first via normalizeMarkdown → chunkMarkdown.
 */
import { describe, it } from 'vitest'
import { readFileSync } from 'fs'
import { chunkMarkdown } from '@/services/ingest/chunking.service'

/** Count all [ that could start a link (excluding escaped \[) */
function countOpenBrackets(text: string): number {
  return (text.match(/(?<!\\)\[/g) || []).length
}

/** Count all ]( that could be part of a link */
function countLinkTransitions(text: string): number {
  return (text.match(/\]\(/g) || []).length
}

describe('measure after change', () => {
  it('britney corpus', () => {
    const corpus = JSON.parse(readFileSync('src/dev/fixtures/britnet-corpus.json', 'utf8'))
    const documents = corpus.documents || []

    let totalChunks = 0
    let literalMatch = 0
    let contentProperMatch = 0
    let brokenLinks = 0
    let emptySearchText = 0
    let overTokenLimit = 0
    let withOffsets = 0
    const sizes: number[] = []

    for (const doc of documents) {
      const text = doc.content || doc.text || ''
      if (!text) continue
      const chunks = chunkMarkdown(text)
      for (const chunk of chunks) {
        totalChunks++
        sizes.push(chunk.text.length)
        if (!chunk.searchText.trim()) emptySearchText++
        if (chunk.searchText.length > 4 * 256) overTokenLimit++
        
        // Check if entire chunk text is literal substring
        const normalizedChunk = chunk.text.replace(/\s+/g, ' ').trim()
        const normalizedDoc = text.replace(/\s+/g, ' ')
        if (normalizedDoc.includes(normalizedChunk)) {
          literalMatch++
        }
        
        // Check if content proper (sourceStart to sourceEnd) is literal substring
        if (chunk.sourceStart !== undefined && chunk.sourceEnd !== undefined) {
          withOffsets++
          const contentProper = text.slice(chunk.sourceStart, chunk.sourceEnd)
          const normalizedContent = contentProper.replace(/\s+/g, ' ').trim()
          if (normalizedDoc.includes(normalizedContent)) {
            contentProperMatch++
          }
        }
        
        // Check link integrity
        const openBrackets = countOpenBrackets(chunk.text)
        const linkTransitions = countLinkTransitions(chunk.text)
        if (openBrackets !== linkTransitions) {
          brokenLinks++
        }
      }
    }

    console.log(`\n=== BRITNEY CORPUS (after change) ===`)
    console.log(`Total chunks: ${totalChunks}`)
    console.log(`Entire chunk text is literal substring: ${literalMatch}/${totalChunks} (${(100*literalMatch/totalChunks).toFixed(1)}%)`)
    console.log(`Content proper (excl. overlap) is literal substring: ${contentProperMatch}/${withOffsets} (${(100*contentProperMatch/withOffsets).toFixed(1)}%)`)
    console.log(`Chunks with sourceStart/sourceEnd: ${withOffsets}/${totalChunks}`)
    console.log(`Broken links: ${brokenLinks}`)
    console.log(`Empty searchText: ${emptySearchText}`)
    console.log(`Over token limit: ${overTokenLimit}`)
    console.log(`Size: min=${Math.min(...sizes)} max=${Math.max(...sizes)} avg=${(sizes.reduce((a,b)=>a+b,0)/sizes.length).toFixed(0)}`)
  })

  it('qasper corpus', () => {
    const qasper1 = readFileSync('src/dev/fixtures/qasper-1910_11471.md', 'utf8')
    const qasper2 = readFileSync('src/dev/fixtures/qasper-1908_06606.md', 'utf8')
    let qTotal = 0, qLiteral = 0, qContentProperMatch = 0, qBroken = 0, qEmpty = 0, qOver = 0, qWithOffsets = 0
    const qSizes: number[] = []
    for (const text of [qasper1, qasper2]) {
      const chunks = chunkMarkdown(text)
      for (const chunk of chunks) {
        qTotal++
        qSizes.push(chunk.text.length)
        if (!chunk.searchText.trim()) qEmpty++
        if (chunk.searchText.length > 4 * 256) qOver++
        
        const normalizedChunk = chunk.text.replace(/\s+/g, ' ').trim()
        const normalizedDoc = text.replace(/\s+/g, ' ')
        if (normalizedDoc.includes(normalizedChunk)) qLiteral++
        
        if (chunk.sourceStart !== undefined && chunk.sourceEnd !== undefined) {
          qWithOffsets++
          const contentProper = text.slice(chunk.sourceStart, chunk.sourceEnd)
          const normalizedContent = contentProper.replace(/\s+/g, ' ').trim()
          if (normalizedDoc.includes(normalizedContent)) {
            qContentProperMatch++
          }
        }
        
        const openBrackets = countOpenBrackets(chunk.text)
        const linkTransitions = countLinkTransitions(chunk.text)
        if (openBrackets !== linkTransitions) qBroken++
      }
    }
    console.log(`\n=== QASPER CORPUS (after change) ===`)
    console.log(`Total chunks: ${qTotal}`)
    console.log(`Entire chunk text is literal substring: ${qLiteral}/${qTotal} (${(100*qLiteral/qTotal).toFixed(1)}%)`)
    console.log(`Content proper (excl. overlap) is literal substring: ${qContentProperMatch}/${qWithOffsets} (${(100*qContentProperMatch/qWithOffsets).toFixed(1)}%)`)
    console.log(`Chunks with sourceStart/sourceEnd: ${qWithOffsets}/${qTotal}`)
    console.log(`Broken links: ${qBroken}`)
    console.log(`Empty searchText: ${qEmpty}`)
    console.log(`Over token limit: ${qOver}`)
    console.log(`Size: min=${Math.min(...qSizes)} max=${Math.max(...qSizes)} avg=${(qSizes.reduce((a,b)=>a+b,0)/qSizes.length).toFixed(0)}`)
  })
})
