import { useProcessingCountData } from './data/useProcessingCountData'

/**
 * Business hook: Check if there are any documents currently being processed.
 * Returns true if any document has a processing status.
 */
export function useProcessingDocuments(): boolean {
  const count = useProcessingCountData()
  return count > 0
}
