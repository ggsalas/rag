import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'soft'
  | 'softDanger'
  | 'ghost'
export type ButtonSize = 'xs' | 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

// `border` (width only) is set here; each variant sets its own border color so
// the outline is always visible. Setting a color here too would win the CSS
// cascade and hide the variant border.
const baseStyles =
  'inline-flex items-center justify-center font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed cursor-pointer'

// Outline aesthetic: transparent background + colored border/text at rest, a
// subtle accent fill only on hover. `primary` is the exception — a solid black
// fill reserved for the main call-to-action buttons. Filled backgrounds are
// otherwise reserved for progress bars and sliders.
const variantStyles: Record<ButtonVariant, string> = {
  // Filled CTA. When disabled it drops the fill and becomes an outline with
  // gray text — matching the outline family instead of a dimmed black block.
  primary:
    'bg-primary text-primary-foreground border-primary hover:bg-primary-hover focus:ring-ring disabled:bg-transparent disabled:text-muted-foreground disabled:border-border',
  secondary:
    'bg-transparent border-border text-foreground hover:bg-accent focus:ring-ring disabled:opacity-50',
  // Monochrome danger: a stronger (foreground) outline instead of red.
  danger:
    'bg-transparent border-foreground text-foreground hover:bg-accent focus:ring-ring disabled:opacity-50',
  soft: 'bg-transparent border-border text-foreground hover:bg-accent focus:ring-ring disabled:opacity-50',
  softDanger:
    'bg-transparent border-foreground text-foreground hover:bg-accent focus:ring-ring disabled:opacity-50',
  ghost:
    'bg-transparent border-transparent text-foreground hover:bg-accent focus:ring-ring disabled:opacity-50',
}

/**
 * Padding/height/text tokens shared by Button and Input, so a control and a
 * button of the same `size` line up at the same height.
 */
export const controlSizeStyles: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-sm',
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
}

/**
 * Builds the Button's Tailwind classes independent of the rendered element,
 * so the same look can be applied to a `<Link>`/`<a>` (or anything else).
 */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  className = '',
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
} = {}) {
  return `${baseStyles} ${variantStyles[variant]} ${controlSizeStyles[size]} ${className}`.trim()
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonClasses({ variant, size, className })}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {children}
    </button>
  )
}
