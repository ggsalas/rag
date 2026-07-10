import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SidebarState {
  /** Whether the sidebar is expanded. Persisted across reloads. */
  isOpen: boolean
  toggle: () => void
  setOpen: (open: boolean) => void
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      isOpen: true,
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      setOpen: (open) => set({ isOpen: open }),
    }),
    { name: 'sidebar-open' },
  ),
)
