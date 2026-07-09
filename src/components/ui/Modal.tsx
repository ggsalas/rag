import { useEffect, useId, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  /** Optional heading rendered at the top and wired up as the dialog's label. */
  title?: ReactNode
  children: ReactNode
  /** Optional actions row rendered at the bottom, right-aligned. */
  footer?: ReactNode
  /** Whether clicking the backdrop closes the modal. Defaults to true. */
  closeOnBackdropClick?: boolean
}

/** Generic centered modal dialog: backdrop, Escape-to-close, and body scroll lock. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  closeOnBackdropClick = true,
}: ModalProps) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={closeOnBackdropClick ? onClose : undefined}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md rounded-lg border border-border bg-background p-6">
        {title && (
          <h2 id={titleId} className="text-lg font-semibold text-foreground">
            {title}
          </h2>
        )}
        <div className={title ? 'mt-2' : undefined}>{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}
