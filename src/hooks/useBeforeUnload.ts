import { useEffect } from 'react'

/**
 * Hook to warn the user before leaving the page when a condition is met.
 * Typically used to prevent accidental data loss during async operations.
 *
 * @param shouldWarn - Whether to show the warning dialog
 * @param message - Optional custom message (most browsers ignore this and show their own)
 */
export function useBeforeUnload(shouldWarn: boolean, message?: string) {
  useEffect(() => {
    if (!shouldWarn) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Standard way to trigger browser's confirmation dialog
      e.preventDefault()
      // Chrome requires returnValue to be set
      e.returnValue = message || ''
      // For older browsers
      return message || ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [shouldWarn, message])
}
