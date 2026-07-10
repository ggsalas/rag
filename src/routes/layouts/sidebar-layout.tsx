import { Outlet } from 'react-router'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { SidebarToggle } from '@/components/sidebar/SidebarToggle'
import { useSidebarStore } from '@/store/sidebar.store'
import { useMediaQuery } from '@/hooks/useMediaQuery'

export function SidebarLayout() {
  // Below the `lg` breakpoint the sidebar floats over the content instead of
  // pushing it, so narrow viewports keep the full width for the main panel.
  const isFloating = useMediaQuery('(max-width: 1023px)')
  const isOpen = useSidebarStore((state) => state.isOpen)
  const setOpen = useSidebarStore((state) => state.setOpen)

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Backdrop: only while floating and open. Clicking it closes the sidebar. */}
      {isFloating && isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={
          isFloating
            ? `fixed inset-y-0 left-0 z-40 flex w-72 flex-col overflow-hidden border-r border-border bg-background transition-transform duration-300 ease-in-out ${
                isOpen ? 'translate-x-0' : '-translate-x-full'
              }`
            : `flex-shrink-0 overflow-hidden bg-background transition-[width] duration-300 ease-in-out ${
                isOpen ? 'w-72 border-r border-border' : 'w-0'
              }`
        }
      >
        {/* Fixed inner width keeps the content from reflowing while collapsing. */}
        <div className="flex h-full w-72 flex-col overflow-hidden">
          <Sidebar />
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>

      <SidebarToggle />
    </div>
  )
}
