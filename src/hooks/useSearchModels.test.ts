import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSearchModels, combineSearchModelsStatus } from './useSearchModels'
import { useAppStore } from '@/store/app.store'

// Mock services — embedding service is mocked to verify the hook NEVER calls it
vi.mock('@/services/embedding/embedding.service', () => ({
  initEmbeddingModel: vi.fn(),
}))

vi.mock('@/services/search/cross-encoder.service', () => ({
  loadCrossEncoderModel: vi.fn(),
  resetCrossEncoderLoadState: vi.fn(),
}))

import { initEmbeddingModel } from '@/services/embedding/embedding.service'
import {
  loadCrossEncoderModel,
  resetCrossEncoderLoadState,
} from '@/services/search/cross-encoder.service'

const mockInitEmbedding = vi.mocked(initEmbeddingModel)
const mockLoadCrossEncoder = vi.mocked(loadCrossEncoderModel)
const mockResetCrossEncoder = vi.mocked(resetCrossEncoderLoadState)

/** Flush microtask queue so .then/.catch handlers run */
const flushPromises = () => new Promise((r) => setTimeout(r, 0))

const defaultCallbacks = {
  onLoadStart: vi.fn(),
  onLoadEnd: vi.fn(),
  onLoadError: vi.fn(),
}

function resetStore() {
  useAppStore.setState({
    embeddingStatus: 'idle',
    embeddingProgress: 0,
    crossEncoderStatus: 'idle',
    crossEncoderProgress: 0,
  })
}

describe('useSearchModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
    mockLoadCrossEncoder.mockResolvedValue(undefined)
  })

  describe('combineSearchModelsStatus', () => {
    it('returns ready when both are ready', () => {
      expect(combineSearchModelsStatus('ready', 'ready')).toBe('ready')
    })

    it('returns error when any is error', () => {
      expect(combineSearchModelsStatus('error', 'ready')).toBe('error')
      expect(combineSearchModelsStatus('ready', 'error')).toBe('error')
    })

    it('returns loading when any is loading', () => {
      expect(combineSearchModelsStatus('loading', 'ready')).toBe('loading')
      expect(combineSearchModelsStatus('ready', 'loading')).toBe('loading')
    })

    it('returns idle when both are idle', () => {
      expect(combineSearchModelsStatus('idle', 'idle')).toBe('idle')
    })
  })

  describe('ownership: never loads embedding', () => {
    it('never calls initEmbeddingModel regardless of embedding status', async () => {
      useAppStore.setState({ embeddingStatus: 'idle' })
      renderHook(() => useSearchModels(defaultCallbacks))
      await act(flushPromises)

      expect(mockInitEmbedding).not.toHaveBeenCalled()
    })

    it('does not call initEmbeddingModel even when embedding is idle and cross-encoder loads', async () => {
      renderHook(() => useSearchModels(defaultCallbacks))
      await act(flushPromises)

      expect(mockInitEmbedding).not.toHaveBeenCalled()
      expect(mockLoadCrossEncoder).toHaveBeenCalledTimes(1)
    })
  })

  describe('cross-encoder loading', () => {
    it('starts cross-encoder when embedding is ready and cross-encoder is idle', async () => {
      useAppStore.setState({ embeddingStatus: 'ready' })

      const { result } = renderHook(() => useSearchModels(defaultCallbacks))

      expect(mockLoadCrossEncoder).toHaveBeenCalledTimes(1)
      expect(result.current.combinedStatus).toBe('loading')

      await act(flushPromises)

      expect(result.current.crossEncoderStatus).toBe('ready')
      expect(result.current.combinedStatus).toBe('ready')
      expect(defaultCallbacks.onLoadStart).toHaveBeenCalledTimes(1)
      expect(defaultCallbacks.onLoadEnd).toHaveBeenCalledTimes(1)
    })

    it('stays loading when cross-encoder is ready but embedding is idle (observed externally)', async () => {
      useAppStore.setState({ crossEncoderStatus: 'ready' })

      const { result } = renderHook(() => useSearchModels(defaultCallbacks))

      // Cross-encoder already ready → no load attempt
      expect(mockLoadCrossEncoder).not.toHaveBeenCalled()
      // Embedding idle → combined is loading
      expect(result.current.combinedStatus).toBe('loading')

      // Simulate App/useEmbeddingStatus finishing the embedding load
      await act(() => {
        useAppStore.setState({ embeddingStatus: 'ready' })
      })

      expect(result.current.combinedStatus).toBe('ready')
      expect(defaultCallbacks.onLoadEnd).toHaveBeenCalledTimes(1)
    })

    it('does not restart cross-encoder that is already loading', () => {
      useAppStore.setState({ crossEncoderStatus: 'loading' })

      renderHook(() => useSearchModels(defaultCallbacks))

      expect(mockLoadCrossEncoder).not.toHaveBeenCalled()
    })

    it('does not restart cross-encoder that is in error state', () => {
      useAppStore.setState({ crossEncoderStatus: 'error' })

      renderHook(() => useSearchModels(defaultCallbacks))

      expect(mockLoadCrossEncoder).not.toHaveBeenCalled()
    })
  })

  describe('embedding status observation', () => {
    it('combined is error when embedding is error (even if cross-encoder succeeds)', async () => {
      useAppStore.setState({ embeddingStatus: 'error' })

      const { result } = renderHook(() => useSearchModels(defaultCallbacks))

      await act(flushPromises)

      expect(result.current.crossEncoderStatus).toBe('ready')
      expect(result.current.combinedStatus).toBe('error')
    })

    it('combined is loading when embedding is loading', async () => {
      useAppStore.setState({ embeddingStatus: 'loading' })

      const { result } = renderHook(() => useSearchModels(defaultCallbacks))

      await act(flushPromises)

      expect(result.current.crossEncoderStatus).toBe('ready')
      expect(result.current.combinedStatus).toBe('loading')
    })
  })

  describe('error handling', () => {
    it('sets cross-encoder to error and forwards the real error message on rejection', async () => {
      mockLoadCrossEncoder.mockRejectedValue(new Error('GPU out of memory'))

      const { result } = renderHook(() => useSearchModels(defaultCallbacks))

      await act(flushPromises)

      expect(result.current.crossEncoderStatus).toBe('error')
      expect(result.current.combinedStatus).toBe('error')
      expect(defaultCallbacks.onLoadError).toHaveBeenCalledWith('GPU out of memory')
    })

    it('uses a fallback message when the rejection reason is not an Error', async () => {
      mockLoadCrossEncoder.mockRejectedValue('string-rejection')

      const { result } = renderHook(() => useSearchModels(defaultCallbacks))

      await act(flushPromises)

      expect(result.current.crossEncoderStatus).toBe('error')
      expect(defaultCallbacks.onLoadError).toHaveBeenCalledWith(
        'Failed to load cross-encoder model',
      )
    })
  })

  describe('retry', () => {
    it('resets cross-encoder and relaunches it after error', async () => {
      // Embedding owned by App — simulate it already ready
      useAppStore.setState({ embeddingStatus: 'ready' })
      mockLoadCrossEncoder.mockRejectedValueOnce(new Error('cross-encoder fail'))

      const { result } = renderHook(() => useSearchModels(defaultCallbacks))
      await act(flushPromises)

      expect(result.current.combinedStatus).toBe('error')

      mockLoadCrossEncoder.mockResolvedValue(undefined)

      act(() => {
        result.current.retry()
      })

      expect(mockResetCrossEncoder).toHaveBeenCalledTimes(1)
      expect(result.current.crossEncoderStatus).toBe('loading')

      await act(flushPromises)

      expect(result.current.crossEncoderStatus).toBe('ready')
      expect(result.current.combinedStatus).toBe('ready')
    })

    it('resets embedding to idle when it was in error, so App/useEmbeddingStatus can retry', async () => {
      useAppStore.setState({ embeddingStatus: 'error' })
      mockLoadCrossEncoder.mockRejectedValueOnce(new Error('cross-encoder fail'))

      const { result } = renderHook(() => useSearchModels(defaultCallbacks))
      await act(flushPromises)

      expect(result.current.embeddingStatus).toBe('error')

      act(() => {
        result.current.retry()
      })

      // Embedding was error → retry resets it to idle for App/useEmbeddingStatus
      expect(result.current.embeddingStatus).toBe('idle')
      expect(useAppStore.getState().embeddingProgress).toBe(0)
      // Cross-encoder was reset and effect immediately set it to loading
      expect(mockResetCrossEncoder).toHaveBeenCalledTimes(1)
      expect(result.current.crossEncoderStatus).toBe('loading')
    })

    it('leaves embedding ready when retrying after cross-encoder error', async () => {
      useAppStore.setState({ embeddingStatus: 'ready' })
      mockLoadCrossEncoder.mockRejectedValueOnce(new Error('cross-encoder fail'))

      const { result } = renderHook(() => useSearchModels(defaultCallbacks))
      await act(flushPromises)

      expect(result.current.embeddingStatus).toBe('ready')
      expect(result.current.crossEncoderStatus).toBe('error')

      mockLoadCrossEncoder.mockResolvedValue(undefined)

      act(() => {
        result.current.retry()
      })

      // Embedding was ready → retry leaves it alone
      expect(result.current.embeddingStatus).toBe('ready')
      // Cross-encoder reset and relaunched
      expect(result.current.crossEncoderStatus).toBe('loading')

      await act(flushPromises)

      expect(result.current.crossEncoderStatus).toBe('ready')
      expect(result.current.combinedStatus).toBe('ready')
    })

    it('fires onLoadStart again after retry', async () => {
      useAppStore.setState({ embeddingStatus: 'ready' })
      mockLoadCrossEncoder.mockRejectedValueOnce(new Error('cross-encoder fail'))

      const { result } = renderHook(() => useSearchModels(defaultCallbacks))
      await act(flushPromises)

      expect(defaultCallbacks.onLoadStart).toHaveBeenCalledTimes(1)

      mockLoadCrossEncoder.mockResolvedValue(undefined)
      defaultCallbacks.onLoadStart.mockClear()

      act(() => {
        result.current.retry()
      })

      expect(defaultCallbacks.onLoadStart).toHaveBeenCalledTimes(1)

      await act(flushPromises)
      expect(result.current.combinedStatus).toBe('ready')
    })
  })

  describe('effect re-execution', () => {
    it('does not duplicate cross-encoder load or onLoadStart when the effect re-runs mid-cycle', async () => {
      const { result } = renderHook(() => useSearchModels(defaultCallbacks))

      // Initial effect started cross-encoder exactly once
      expect(mockLoadCrossEncoder).toHaveBeenCalledTimes(1)
      expect(defaultCallbacks.onLoadStart).toHaveBeenCalledTimes(1)

      // Simulate effect re-run triggered by cross-encoder going to loading
      act(() => {
        useAppStore.setState({ crossEncoderStatus: 'loading' })
      })

      // No duplicate start
      expect(mockLoadCrossEncoder).toHaveBeenCalledTimes(1)
      expect(defaultCallbacks.onLoadStart).toHaveBeenCalledTimes(1)

      // Cross-encoder resolves — lifecycle is clean
      await act(flushPromises)
      expect(result.current.crossEncoderStatus).toBe('ready')
    })
  })
})
