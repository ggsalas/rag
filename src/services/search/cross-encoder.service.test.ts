import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  loadCrossEncoderModel,
  resetCrossEncoderLoadState,
  CrossEncoderNotReadyError,
  rankWithCrossEncoder,
  isCrossEncoderReady,
} from './cross-encoder.service'

vi.mock('@/infrastructure/worker-pool', () => ({
  getRerankerWorker: vi.fn(),
}))

import { getRerankerWorker } from '@/infrastructure/worker-pool'

const mockGetRerankerWorker = vi.mocked(getRerankerWorker)

function makeMockWorker(overrides: {
  loadModel?: () => Promise<void>
  scorePairs?: () => Promise<number[]>
} = {}) {
  return {
    loadModel: vi.fn(overrides.loadModel ?? (() => Promise.resolve())),
    scorePairs: vi.fn(overrides.scorePairs ?? (() => Promise.resolve([]))),
  } as unknown as ReturnType<typeof getRerankerWorker>
}

describe('cross-encoder.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Full reset of the module load state (including the loaded flag), so
    // every test starts from a clean, not-loaded state.
    resetCrossEncoderLoadState()
  })

  describe('loadCrossEncoderModel', () => {
    it('resolves when the worker loads the model successfully', async () => {
      mockGetRerankerWorker.mockReturnValue(makeMockWorker())

      await expect(loadCrossEncoderModel()).resolves.toBeUndefined()
      expect(isCrossEncoderReady()).toBe(true)
    })

    it('rejects with CrossEncoderNotReadyError containing the real error message', async () => {
      const originalError = new Error('GPU out of memory')
      mockGetRerankerWorker.mockReturnValue(
        makeMockWorker({ loadModel: () => Promise.reject(originalError) }),
      )

      await expect(loadCrossEncoderModel()).rejects.toThrow(CrossEncoderNotReadyError)

      try {
        await loadCrossEncoderModel()
      } catch (e) {
        // Already failed — cached rejection path
      }

      // Use a fresh rejection to inspect the error
      resetCrossEncoderLoadState()
      mockGetRerankerWorker.mockReturnValue(
        makeMockWorker({ loadModel: () => Promise.reject(originalError) }),
      )

      try {
        await loadCrossEncoderModel()
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(CrossEncoderNotReadyError)
        const err = e as CrossEncoderNotReadyError
        expect(err.message).toContain('GPU out of memory')
        expect(err.cause).toBe(originalError)
      }
    })

    it('rejects immediately on subsequent calls without retrying the worker', async () => {
      const originalError = new Error('download failed')
      const mockWorker = makeMockWorker({
        loadModel: () => Promise.reject(originalError),
      })
      mockGetRerankerWorker.mockReturnValue(mockWorker)

      // First call triggers the load
      await expect(loadCrossEncoderModel()).rejects.toThrow(CrossEncoderNotReadyError)

      // Second call should reject without calling the worker again
      await expect(loadCrossEncoderModel()).rejects.toThrow(CrossEncoderNotReadyError)
      expect(mockWorker.loadModel).toHaveBeenCalledTimes(1)
    })

    it('preserves the original error message on cached-failure rejections', async () => {
      const originalError = new Error('model file corrupted')
      mockGetRerankerWorker.mockReturnValue(
        makeMockWorker({ loadModel: () => Promise.reject(originalError) }),
      )

      await expect(loadCrossEncoderModel()).rejects.toThrow(/model file corrupted/)

      // Subsequent call should also carry the original message
      await expect(loadCrossEncoderModel()).rejects.toThrow(/model file corrupted/)
    })

    it('allows retry after resetCrossEncoderLoadState', async () => {
      const failWorker = makeMockWorker({
        loadModel: () => Promise.reject(new Error('transient')),
      })
      mockGetRerankerWorker.mockReturnValue(failWorker)

      await expect(loadCrossEncoderModel()).rejects.toThrow(CrossEncoderNotReadyError)

      resetCrossEncoderLoadState()

      const okWorker = makeMockWorker()
      mockGetRerankerWorker.mockReturnValue(okWorker)

      await expect(loadCrossEncoderModel()).resolves.toBeUndefined()
      expect(okWorker.loadModel).toHaveBeenCalledTimes(1)
    })
  })

  describe('rankWithCrossEncoder', () => {
    it('throws CrossEncoderNotReadyError if model is not loaded', async () => {
      await expect(
        rankWithCrossEncoder('q', [{ chunkId: '1', searchText: 't' } as never]),
      ).rejects.toThrow(CrossEncoderNotReadyError)
    })
  })
})
