/**
 * Keeps the SVG favicon in sync with the OS color-scheme preference.
 *
 * The favicon SVG carries its own `prefers-color-scheme` media query, but
 * Chrome rasterizes the icon once and does not re-evaluate it when the system
 * theme changes at runtime. Reassigning the link href forces a re-fetch so the
 * media query is evaluated again with the current preference.
 */
export function syncFaviconWithColorScheme(): void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')

  mq.addEventListener('change', () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) return
    const base = import.meta.env.BASE_URL
    // Cache-busting query param makes Chrome treat it as a new resource.
    link.href = `${base}icons/icon.svg?v=${mq.matches ? 'dark' : 'light'}`
  })
}
