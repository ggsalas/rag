import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSearchPreferences, inferPresetFromWeights } from './useSearchPreferences'
import { DEFAULT_SEARCH_PRESET, SEARCH_PRESETS } from '@/lib/constants'
import type { SearchPreferences } from '@/types/library'

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

  describe('inferPresetFromWeights', () => {
    it('should infer balanced preset for 50/50 weights', () => {
      expect(inferPresetFromWeights({ text: 0.5, vector: 0.5 })).toBe('balanced')
    })

    it('should infer semantic preset for vector-dominant weights (>= 0.7)', () => {
      expect(inferPresetFromWeights({ text: 0.3, vector: 0.7 })).toBe('semantic')
      expect(inferPresetFromWeights({ text: 0.2, vector: 0.8 })).toBe('semantic')
      expect(inferPresetFromWeights({ text: 0.1, vector: 0.9 })).toBe('semantic')
    })

    it('should infer balanced preset for text-dominant weights', () => {
      expect(inferPresetFromWeights({ text: 0.6, vector: 0.4 })).toBe('balanced')
      expect(inferPresetFromWeights({ text: 0.7, vector: 0.3 })).toBe('balanced')
    })

    it('should infer balanced preset for weights between 0.5 and 0.7 vector', () => {
      expect(inferPresetFromWeights({ text: 0.4, vector: 0.6 })).toBe('balanced')
    })
  })

  describe('initial state', () => {
    it('should use default preset when no initial prefs provided', () => {
      const { result } = renderHook(() =>
        useSearchPreferences('lib-1', null),
      )

      expect(result.current.searchPreset).toBe(DEFAULT_SEARCH_PRESET)
      expect(result.current.hybridWeights).toEqual(
        SEARCH_PRESETS[DEFAULT_SEARCH_PRESET],
      )
    })

    it('should use explicit searchPreset from initial prefs', () => {
      const initialPrefs: SearchPreferences = {
        searchPreset: 'semantic',
        maxResults: 10,
        minScore: 70,
      }

      const { result } = renderHook(() =>
        useSearchPreferences('lib-1', initialPrefs),
      )

      expect(result.current.searchPreset).toBe('semantic')
      expect(result.current.hybridWeights).toEqual(SEARCH_PRESETS.semantic)
    })

    it('should infer preset from legacy hybridWeights when searchPreset is missing', () => {
      const initialPrefs: SearchPreferences = {
        hybridWeights: { text: 0.1, vector: 0.9 },
        maxResults: 10,
        minScore: 70,
      }

      const { result } = renderHook(() =>
        useSearchPreferences('lib-1', initialPrefs),
      )

      expect(result.current.searchPreset).toBe('semantic')
      expect(result.current.hybridWeights).toEqual(SEARCH_PRESETS.semantic)
    })

    it('should infer balanced preset from legacy 50/50 weights', () => {
      const initialPrefs: SearchPreferences = {
        hybridWeights: { text: 0.5, vector: 0.5 },
        maxResults: 10,
        minScore: 70,
      }

      const { result } = renderHook(() =>
        useSearchPreferences('lib-1', initialPrefs),
      )

      expect(result.current.searchPreset).toBe('balanced')
    })
  })

  describe('setSearchPreset', () => {
    it('should update preset and derive hybrid weights', () => {
      const { result } = renderHook(() =>
        useSearchPreferences('lib-1', null),
      )

      expect(result.current.searchPreset).toBe('balanced')

      act(() => {
        result.current.setSearchPreset('semantic')
      })

      expect(result.current.searchPreset).toBe('semantic')
      expect(result.current.hybridWeights).toEqual(SEARCH_PRESETS.semantic)
    })

    it('should persist both searchPreset and hybridWeights', () => {
      const { result } = renderHook(() =>
        useSearchPreferences('lib-1', null),
      )

      act(() => {
        result.current.setSearchPreset('semantic')
      })

      expect(mockUpdateSearchPreferences).toHaveBeenCalledWith(
        'lib-1',
        expect.objectContaining({
          searchPreset: 'semantic',
          hybridWeights: SEARCH_PRESETS.semantic,
        }),
      )
    })

    it('should switch back to balanced preset', () => {
      const { result } = renderHook(() =>
        useSearchPreferences('lib-1', null),
      )

      act(() => {
        result.current.setSearchPreset('semantic')
      })

      expect(result.current.searchPreset).toBe('semantic')

      act(() => {
        result.current.setSearchPreset('balanced')
      })

      expect(result.current.searchPreset).toBe('balanced')
      expect(result.current.hybridWeights).toEqual(SEARCH_PRESETS.balanced)
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

    it('should update minScore and persist', () => {
      const { result } = renderHook(() =>
        useSearchPreferences('lib-1', null),
      )

      act(() => {
        result.current.setMinScore(80)
      })

      expect(result.current.minScore).toBe(80)
      expect(mockUpdateSearchPreferences).toHaveBeenCalledWith(
        'lib-1',
        expect.objectContaining({ minScore: 80 }),
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
  })
})
