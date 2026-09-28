import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSearchPreferences } from './useSearchPreferences'
import { DEFAULT_HYBRID_WEIGHTS } from '@/lib/constants'

// Mock the library service
vi.mock('@/services/library.service', () => ({
  updateSearchPreferences: vi.fn(),
}))

import * as libraryService from '@/services/library.service'

const mockUpdateSearchPreferences = vi.mocked(libraryService.updateSearchPreferences)

describe('useSearchPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('hybrid weights', () => {
    it('should always return the fixed DEFAULT_HYBRID_WEIGHTS', () => {
      const { result } = renderHook(() =>
        useSearchPreferences('lib-1', null),
      )

      expect(result.current.hybridWeights).toEqual(DEFAULT_HYBRID_WEIGHTS)
    })

    it('should ignore legacy searchPreset, hybridWeights, and minScore from initial prefs', () => {
      const initialPrefs = {
        // Legacy fields that should be ignored
        searchPreset: 'semantic' as any,
        hybridWeights: { text: 0.1, vector: 0.9 } as any,
        maxResults: 10,
        minScore: 70,
      }

      const { result } = renderHook(() =>
        useSearchPreferences('lib-1', initialPrefs),
      )

      expect(result.current.hybridWeights).toEqual(DEFAULT_HYBRID_WEIGHTS)
    })
  })

  describe('other preferences', () => {
    it('should update maxResults and persist', () => {
      const { result } = renderHook(() =>
        useSearchPreferences('lib-1', null),
      )

      act(() => {
        result.current.setMaxResults(20)
      })

      expect(result.current.maxResults).toBe(20)
      expect(mockUpdateSearchPreferences).toHaveBeenCalledWith(
        'lib-1',
        expect.objectContaining({ maxResults: 20 }),
      )
    })

    it('should update isAiMode and persist', () => {
      const { result } = renderHook(() =>
        useSearchPreferences('lib-1', null),
      )

      act(() => {
        result.current.setIsAiMode(true)
      })

      expect(result.current.isAiMode).toBe(true)
      expect(mockUpdateSearchPreferences).toHaveBeenCalledWith(
        'lib-1',
        expect.objectContaining({ isAiMode: true }),
      )
    })

    it('should not persist legacy searchPreset, hybridWeights, or minScore fields', () => {
      const { result } = renderHook(() =>
        useSearchPreferences('lib-1', null),
      )

      act(() => {
        result.current.setMaxResults(10)
      })

      const persisted = mockUpdateSearchPreferences.mock.calls[0]?.[1]
      expect(persisted).toBeDefined()
      expect(persisted).not.toHaveProperty('searchPreset')
      expect(persisted).not.toHaveProperty('hybridWeights')
      expect(persisted).not.toHaveProperty('minScore')
    })
  })
})
