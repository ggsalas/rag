import { describe, it, expect, beforeEach } from 'vitest'
import type { SearchResult } from '@/types/search'
import {
  buildContext,
  generateAnswer,
  type LLMCitation,
} from './llm.service'

/** Minimal SearchResult factory — only the fields buildContext / generateAnswer read. */
function makeResult(overrides: Partial<SearchResult> & Pick<SearchResult, 'chunkId' | 'searchText'>): SearchResult {
  return {
    chunkId: overrides.chunkId,
    documentId: overrides.documentId ?? 'doc-1',
    documentName: overrides.documentName ?? 'Doc',
    text: overrides.text ?? overrides.searchText,
    searchText: overrides.searchText,
    sectionPath: overrides.sectionPath ?? [],
    headingText: overrides.headingText ?? '',
    score: overrides.score ?? 1,
    chunkIndex: overrides.chunkIndex ?? 0,
  }
}

// The module stores its engine on a window-scoped singleton so HMR doesn't
// lose it. The `state` const in the service captures the object reference at
// module load, so tests must mutate its properties rather than replace it.
const GLOBAL_KEY = '__llmModuleState__'
type ModuleState = { engine: unknown; isRunning: boolean }
function getState(): ModuleState {
  const s = (globalThis as unknown as Record<string, ModuleState>)[GLOBAL_KEY]
  if (!s) throw new Error('Module state not initialised — import the service first')
  return s
}
function setMockEngine(mock: unknown): void {
  const s = getState()
  s.engine = mock
  s.isRunning = false
}
function readState(): ModuleState {
  return getState()
}

describe('buildContext', () => {
  beforeEach(() => {
    // Reset the module singleton between tests (mutate, don't replace — see note above).
    const s = getState()
    s.engine = null
    s.isRunning = false
  })

  it('returns empty context and citations for empty results', () => {
    const { context, citations } = buildContext([])
    expect(context).toBe('')
    expect(citations).toEqual([])
  })

  it('prefers searchText over Markdown text', () => {
    const results = [
      makeResult({
        chunkId: 'c1',
        searchText: 'plain text body',
        text: '**markdown** _body_',
      }),
    ]
    const { context } = buildContext(results)
    expect(context).toBe('[1] plain text body')
    expect(context).not.toContain('markdown')
  })

  it('truncates each chunk to the per-chunk budget', () => {
    const longText = 'a'.repeat(100)
    const results = [makeResult({ chunkId: 'c1', searchText: longText })]
    const { context } = buildContext(results, { chunkMax: 10, totalBudget: 10_000 })
    // "[1] " (4 chars) + 10 chars of text = 14 chars total
    expect(context).toBe('[1] ' + 'a'.repeat(10))
    expect(context.length).toBe(14)
  })

  it('stops at the total budget and excludes overflowing chunks', () => {
    const results = [
      makeResult({ chunkId: 'c1', searchText: 'first' }),
      makeResult({ chunkId: 'c2', searchText: 'second' }),
      makeResult({ chunkId: 'c3', searchText: 'third' }),
    ]
    // Budget just enough for two pieces: "[1] first" (9) + "\n\n" (2) + "[2] second" (10) = 21
    const { context, citations } = buildContext(results, {
      chunkMax: 1_000,
      totalBudget: 21,
    })
    expect(context).toBe('[1] first\n\n[2] second')
    expect(citations).toHaveLength(2)
    expect(citations.map((c) => c.chunkId)).toEqual(['c1', 'c2'])
  })

  it('numbers citations sequentially for included chunks only', () => {
    // With a very tight budget, only the first chunk fits; its index must still be 1.
    const results = [
      makeResult({ chunkId: 'c1', searchText: 'alpha' }),
      makeResult({ chunkId: 'c2', searchText: 'beta' }),
      makeResult({ chunkId: 'c3', searchText: 'gamma' }),
    ]
    const { context, citations } = buildContext(results, {
      chunkMax: 1_000,
      // "[1] alpha" = 9 chars; "\n\n[2] beta" = 10 chars; total = 19.
      // Budget of 18 fits only the first chunk.
      totalBudget: 18,
    })
    expect(context).toBe('[1] alpha')
    expect(citations).toHaveLength(1)
    // Narrow for strict mode (noUncheckedIndexedAccess); throw fails the test loudly.
    const first = citations[0]
    if (!first) throw new Error('Expected first citation to be defined')
    expect(first.index).toBe(1)
    expect(first.chunkId).toBe('c1')
  })

  it('preserves input order across included chunks', () => {
    const results = [
      makeResult({ chunkId: 'a', searchText: 'one', chunkIndex: 0 }),
      makeResult({ chunkId: 'b', searchText: 'two', chunkIndex: 1 }),
      makeResult({ chunkId: 'c', searchText: 'three', chunkIndex: 2 }),
    ]
    const { citations } = buildContext(results, {
      chunkMax: 1_000,
      totalBudget: 10_000,
    })
    expect(citations.map((c) => c.chunkId)).toEqual(['a', 'b', 'c'])
    expect(citations.map((c) => c.index)).toEqual([1, 2, 3])
  })

  it('treats missing searchText as empty string', () => {
    const r = makeResult({ chunkId: 'c1', searchText: '' })
    // Force searchText to undefined to exercise the `?? ''` branch.
    const broken = { ...r, searchText: undefined as unknown as string }
    const { context, citations } = buildContext([broken])
    expect(context).toBe('[1] ')
    expect(citations).toHaveLength(1)
  })
})

describe('generateAnswer — WebGPU / context-window error handling', () => {
  beforeEach(() => {
    const s = getState()
    s.engine = null
    s.isRunning = false
  })

  /** Builds a mock MLCEngine whose streaming create() rejects with the given message. */
  function mockEngineThrowing(message: string) {
    return {
      chat: {
        completions: {
          create: async () => {
            throw new Error(message)
          },
        },
      },
      interruptGenerate: () => {},
    }
  }

  it('clears the engine and rethrows a concise message on GPU runtime errors', async () => {
    setMockEngine(mockEngineThrowing('GPUBuffer mapAsync failed: buffer is unmapped'))
    const onToken = () => {}

    await expect(
      generateAnswer('q', [makeResult({ chunkId: 'c1', searchText: 'x' })], onToken),
    ).rejects.toThrow(/GPU error during answer generation/)

    expect(readState().engine).toBeNull()
  })

  it('clears the engine on "device lost" errors', async () => {
    setMockEngine(mockEngineThrowing('Device lost'))
    const onToken = () => {}
    await expect(
      generateAnswer('q', [makeResult({ chunkId: 'c1', searchText: 'x' })], onToken),
    ).rejects.toThrow(/GPU error/)
    expect(readState().engine).toBeNull()
  })

  it('clears the engine and surfaces the actionable GPU message on "already disposed" errors', async () => {
    // A stale/disposed engine can survive HMR or a failed reload; MLC throws
    // "The current Object has already been disposed" when used. We must treat
    // this as a broken runtime, clear the engine, and surface the actionable
    // GPU reset message rather than the raw disposed error.
    setMockEngine(mockEngineThrowing('The current Object has already been disposed'))
    const onToken = () => {}

    await expect(
      generateAnswer('q', [makeResult({ chunkId: 'c1', searchText: 'x' })], onToken),
    ).rejects.toThrow(/GPU error during answer generation/)

    expect(readState().engine).toBeNull()
  })

  it('clears the engine and surfaces the actionable GPU message on "instance reference no longer exists" errors', async () => {
    // WebGPU validation error: an external Instance reference (bind group,
    // pipeline, etc.) has been destroyed while still in use. This is the
    // exact message reported for one specific document's generation. Treat
    // it like a disposed-object error — the engine is broken and must be
    // reloaded, and the user should see the actionable GPU reset message.
    setMockEngine(mockEngineThrowing('A valid external Instance reference no longer exists.'))
    const onToken = () => {}

    await expect(
      generateAnswer('q', [makeResult({ chunkId: 'c1', searchText: 'x' })], onToken),
    ).rejects.toThrow(/GPU error during answer generation/)

    expect(readState().engine).toBeNull()
  })

  it('throws a concise message on context-window errors without clearing the engine', async () => {
    const engine = mockEngineThrowing('Input exceeds model context window')
    setMockEngine(engine)
    const onToken = () => {}
    await expect(
      generateAnswer('q', [makeResult({ chunkId: 'c1', searchText: 'x' })], onToken),
    ).rejects.toThrow(/context exceeded/)
    // Engine is still usable — not cleared.
    expect(readState().engine).toBe(engine)
  })

  it('rethrows unrelated errors unchanged and keeps the engine', async () => {
    const engine = mockEngineThrowing('Something completely different')
    setMockEngine(engine)
    const onToken = () => {}
    await expect(
      generateAnswer('q', [makeResult({ chunkId: 'c1', searchText: 'x' })], onToken),
    ).rejects.toThrow('Something completely different')
    expect(readState().engine).toBe(engine)
  })

  it('returns citations on interrupt without clearing the engine', async () => {
    const engine = mockEngineThrowing('Generation interrupted by user')
    setMockEngine(engine)
    const onToken = () => {}
    const results = [makeResult({ chunkId: 'c1', searchText: 'x' })]
    const citations = await generateAnswer('q', results, onToken)
    expect(citations).toHaveLength(1)
    expect((citations[0] as LLMCitation).chunkId).toBe('c1')
    expect(readState().engine).toBe(engine)
  })
})
