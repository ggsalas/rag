import type { InputHTMLAttributes } from 'react'
import { controlSizeStyles, type ButtonSize } from '@/components/ui/Button'

// Omit the native numeric `size` attribute so we can reuse it for the
// Button-aligned size scale (`xs` | `sm` | `md`).
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: ButtonSize
}

const baseStyles =
  'border border-input rounded-lg bg-background text-foreground placeholder-muted-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring disabled:opacity-50 disabled:cursor-not-allowed'

export function Input({ size = 'md', className = '', ...props }: InputProps) {
  return (
    <input
      className={`${baseStyles} ${controlSizeStyles[size]} ${className}`.trim()}
      {...props}
    />
  )
}
