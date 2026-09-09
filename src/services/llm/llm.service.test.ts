import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SearchResult } from '@/types/search'
import {
  buildContext,
  generateAnswer,
  ensureModelLoaded,
  type LLMCitation,
  type ModelLoadCallbacks,
} from './llm.service'

// Mock @mlc-ai/web-llm so ensureModelLoaded tests can control CreateMLCEngine
// without needing a real GPU. The mock is hoisted by Vitest.
const mockCreateMLCEngine = vi.fn()
vi.mock('@mlc-ai/web-llm', () => ({
  CreateMLCEngine: (...args: unknown[]) => mockCreateMLCEngine(...args),
  prebuiltAppConfig: { model_list: [] },
}))

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
type ModuleState = { engine: unknown; isRunning: boolean; activeLoad: Promise<boolean> | null }
function getState(): ModuleState {
  const s = (globalThis as unknown as Record<string, ModuleState>)[GLOBAL_KEY]
  if (!s) throw new Error('Module state not initialised — import the service first')
  return s
}
function setMockEngine(mock: unknown): void {
  const s = getState()
  s.engine = mock
  s.isRunning = false
  s.activeLoad = null
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
    s.activeLoad = null
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
    s.activeLoad = null
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

describe('ensureModelLoaded — stale ready + null engine recovery', () => {
  /** Builds a minimal ModelLoadCallbacks backed by mutable state. */
  function makeCallbacks(initialStatus = 'idle'): ModelLoadCallbacks & { status: string; progress: number; toasts: number; errors: string[] } {
    const cbs = {
      status: initialStatus,
      progress: 0,
      toasts: 0,
      errors: [] as string[],
      listeners: new Set<(s: string) => void>(),
      getStatus() { return cbs.status },
      setStatus(s: string) {
        cbs.status = s
        for (const l of cbs.listeners) l(s)
      },
      setProgress(p: number) { cbs.progress = p },
      subscribe(listener: (s: string) => void) {
        cbs.listeners.add(listener)
        return () => cbs.listeners.delete(listener)
      },
      showToast() { cbs.toasts++ },
      dismissToast() {},
      showErrorToast(msg: string) { cbs.errors.push(msg) },
    }
    return cbs
  }

  beforeEach(() => {
    // Reset module singleton state between tests.
    const s = getState()
    s.engine = null
    s.isRunning = false
    s.activeLoad = null

    mockCreateMLCEngine.mockReset()

    // Stub navigator.gpu so initLLMModel's adapter check passes.
    // Use vi.stubGlobal which is designed for jsdom environment.
    const gpuMock = { requestAdapter: vi.fn().mockResolvedValue({}) }
    vi.stubGlobal('navigator', { ...navigator, gpu: gpuMock })
  })

  it('returns true immediately when status is ready AND engine is non-null', async () => {
    const fakeEngine = { chat: { completions: { create: vi.fn() } } }
    setMockEngine(fakeEngine)

    const cbs = makeCallbacks('ready')
    const signal = new AbortController().signal

    const result = await ensureModelLoaded(signal, cbs)

    expect(result).toBe(true)
    expect(mockCreateMLCEngine).not.toHaveBeenCalled()
    expect(cbs.status).toBe('ready')
  })

  it('reloads when status is ready but engine is null (stale after GPU error)', async () => {
    // Simulate the post-GPU-error state: store says ready, but engine was cleared.
    const s = getState()
    s.engine = null
    s.isRunning = false

    const fakeEngine = { chat: { completions: { create: vi.fn() } } }
    mockCreateMLCEngine.mockResolvedValue(fakeEngine)

    const cbs = makeCallbacks('ready')
    const signal = new AbortController().signal

    const result = await ensureModelLoaded(signal, cbs)

    expect(result).toBe(true)
    expect(mockCreateMLCEngine).toHaveBeenCalledTimes(1)
    expect(cbs.status).toBe('ready')
    expect(getState().engine).toBe(fakeEngine)
  })

  it('transitions through loading when recovering from stale ready', async () => {
    const s = getState()
    s.engine = null

    const statuses: string[] = []
    const fakeEngine = { chat: { completions: { create: vi.fn() } } }
    mockCreateMLCEngine.mockResolvedValue(fakeEngine)

    const cbs = makeCallbacks('ready')
    const origSetStatus = cbs.setStatus.bind(cbs)
    cbs.setStatus = (s: string) => { statuses.push(s); origSetStatus(s) }

    const signal = new AbortController().signal
    await ensureModelLoaded(signal, cbs)

    expect(statuses).toEqual(['loading', 'ready'])
  })

  it('sets status to error when reload fails after stale ready', async () => {
    const s = getState()
    s.engine = null

    mockCreateMLCEngine.mockRejectedValue(new Error('GPU error while loading the AI model.'))

    const cbs = makeCallbacks('ready')
    const signal = new AbortController().signal

    const result = await ensureModelLoaded(signal, cbs)

    expect(result).toBe(false)
    expect(cbs.status).toBe('error')
    expect(cbs.errors).toHaveLength(1)
  })

  it('deduplicates concurrent loads when two callers detect stale ready', async () => {
    const s = getState()
    s.engine = null

    let resolveEngine: ((e: unknown) => void) | null = null
    mockCreateMLCEngine.mockImplementation(
      () => new Promise((resolve) => { resolveEngine = resolve }),
    )

    const cbs = makeCallbacks('ready')
    const sig1 = new AbortController().signal
    const sig2 = new AbortController().signal

    // Start two concurrent ensureModelLoaded calls.
    const p1 = ensureModelLoaded(sig1, cbs)
    const p2 = ensureModelLoaded(sig2, cbs)

    // Wait for the microtask queue to flush so initLLMModel starts.
    await Promise.resolve()
    await Promise.resolve()

    // Only one CreateMLCEngine call should have been made.
    expect(mockCreateMLCEngine).toHaveBeenCalledTimes(1)

    // Resolve the engine and let both promises settle.
    const fakeEngine = { chat: { completions: { create: vi.fn() } } }
    resolveEngine!(fakeEngine)

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe(true)
    // Second caller sees status go to 'ready' via subscription and resolves true.
    expect(r2).toBe(true)
  })

  it('recovers end-to-end: GPU error in generateAnswer → ensureModelLoaded reloads', async () => {
    // Step 1: simulate a working engine that then fails with a GPU error.
    const brokenEngine = {
      chat: {
        completions: {
          create: async () => { throw new Error('GPUBuffer mapAsync failed: buffer is unmapped') },
        },
      },
      interruptGenerate: () => {},
    }
    setMockEngine(brokenEngine)

    const onToken = () => {}
    await expect(
      generateAnswer('q', [makeResult({ chunkId: 'c1', searchText: 'x' })], onToken),
    ).rejects.toThrow(/GPU error during answer generation/)
    expect(getState().engine).toBeNull()

    // Step 2: store still says 'ready' (service doesn't touch Zustand).
    const cbs = makeCallbacks('ready')

    // Step 3: ensureModelLoaded detects stale ready and reloads.
    // The fresh engine needs to return a proper async iterable stream.
    const freshEngine = {
      chat: {
        completions: {
          create: async () => {
            // Return an async iterable that yields one chunk then completes.
            return {
              async *[Symbol.asyncIterator]() {
                yield { choices: [{ delta: { content: 'test token' } }] }
              },
            }
          },
        },
      },
      interruptGenerate: () => {},
    }
    mockCreateMLCEngine.mockResolvedValue(freshEngine)

    const signal = new AbortController().signal
    const result = await ensureModelLoaded(signal, cbs)

    expect(result).toBe(true)
    expect(getState().engine).toBe(freshEngine)
    expect(cbs.status).toBe('ready')

    // Step 4: generateAnswer works with the fresh engine.
    const citations = await generateAnswer('q', [makeResult({ chunkId: 'c1', searchText: 'x' })], onToken)
    expect(citations).toHaveLength(1)
  })

  it('returns false on abort without marking ready', async () => {
    const s = getState()
    s.engine = null

    let resolveEngine: ((e: unknown) => void) | null = null
    mockCreateMLCEngine.mockImplementation(
      () => new Promise((resolve) => { resolveEngine = resolve }),
    )

    const cbs = makeCallbacks('idle')
    const ctrl = new AbortController()

    const p = ensureModelLoaded(ctrl.signal, cbs)
    
    // Wait for the microtask queue to flush so initLLMModel starts and sets resolveEngine.
    await Promise.resolve()
    await Promise.resolve()
    
    // Now abort.
    ctrl.abort()

    // Resolve the engine so the internal promise settles (avoids unhandled rejection).
    resolveEngine!({ chat: { completions: { create: vi.fn() } } })

    const result = await p
    expect(result).toBe(false)
  })
})
