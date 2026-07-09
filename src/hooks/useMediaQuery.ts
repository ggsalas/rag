import { useSyncExternalStore } from 'react'

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 * Re-renders the component whenever the match state changes.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = (callback: () => void) => {
    const mql = window.matchMedia(query)
    mql.addEventListener('change', callback)
    return () => mql.removeEventListener('change', callback)
  }

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}
