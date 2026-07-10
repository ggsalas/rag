import { Menu, ArrowLeft } from 'lucide-react'
import { useSidebarStore } from '@/store/sidebar.store'

/**
 * Floating toggle for the sidebar. It sits at the top-left of the content and
 * translates right by the sidebar width when open, so it always rides the
 * sidebar's right edge — whether the sidebar is docked (pushing content) or
 * floating over it. When open it shows a left arrow to hint that it closes.
 */
export function SidebarToggle() {
  const isOpen = useSidebarStore((state) => state.isOpen)
  const toggle = useSidebarStore((state) => state.toggle)

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isOpen ? 'Close sidebar' : 'Open sidebar'}
      aria-expanded={isOpen}
      className={`fixed top-0 left-0 z-50 flex h-16 items-center pl-3 transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-72' : 'translate-x-0'
      }`}
    >
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-accent">
        {isOpen ? (
          <ArrowLeft className="h-5 w-5" />
        ) : (
          <Menu className="h-5 w-5" />
        )}
      </span>
    </button>
  )
}
