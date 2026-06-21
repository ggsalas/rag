import React from 'react'
import type { HybridWeights } from '@/types/search'

interface HybridWeightsControlProps {
  weights: HybridWeights
  onChange: (weights: HybridWeights) => void
  disabled?: boolean
}

/** Control to adjust hybrid search weights between BM25 (text) and vector (semantic) search */
export function HybridWeightsControl({
  weights,
  onChange,
  disabled = false,
}: HybridWeightsControlProps) {
  const [localValue, setLocalValue] = React.useState(weights.vector)

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(parseFloat(e.target.value))
  }

  const handleSliderRelease = () => {
    const vectorWeight = localValue
    const textWeight = 1 - vectorWeight
    onChange({ vector: vectorWeight, text: textWeight })
  }

  // Sync local value when weights prop changes externally
  React.useEffect(() => {
    setLocalValue(weights.vector)
  }, [weights.vector])

  const isBalanced = localValue === 0.5
  const favorKeyword = (1 - localValue) > localValue
  const modeDescription = isBalanced
    ? 'Balanced: combines exact keyword matching with semantic understanding'
    : favorKeyword
      ? 'Keyword-focused: prioritizes exact term matches (better for technical/specific queries)'
      : 'Semantic-focused: prioritizes meaning over exact words (better for conceptual queries)'

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <label
            htmlFor="hybrid-weight-slider"
            className="text-sm font-medium text-gray-700"
          >
            Search Mode Balance
          </label>
          <span className="text-xs text-gray-500 italic">
            {modeDescription}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600 whitespace-nowrap">
            Keyword
          </span>
          <input
            id="hybrid-weight-slider"
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={localValue}
            onChange={handleSliderChange}
            onMouseUp={handleSliderRelease}
            onTouchEnd={handleSliderRelease}
            disabled={disabled}
            className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="text-xs text-gray-600 whitespace-nowrap">
            Semantic
          </span>
        </div>
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>
          BM25: <strong>{Math.round((1 - localValue) * 100)}%</strong>
        </span>
        <span>
          Vector: <strong>{Math.round(localValue * 100)}%</strong>
        </span>
      </div>
    </div>
  )
}
