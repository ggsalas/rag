import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchBar } from './SearchBar'

const defaultProps = {
  onSearch: vi.fn(),
  isSearching: false,
  embeddingStatus: 'ready' as const,
}

function renderWithPreset(
  preset: 'balanced' | 'semantic' = 'balanced',
  onPresetChange = vi.fn(),
) {
  return render(
    <SearchBar
      {...defaultProps}
      searchPreset={preset}
      onPresetChange={onPresetChange}
    />,
  )
}

describe('SearchBar preset segmented toggle', () => {
  it('renders both Balanced and Semantic buttons', () => {
    renderWithPreset()
    expect(screen.getByText('Balanced')).toBeInTheDocument()
    expect(screen.getByText('Semantic')).toBeInTheDocument()
  })

  it('groups the buttons in a labeled group for accessibility', () => {
    renderWithPreset()
    const group = screen.getByRole('group', { name: 'Search mode' })
    expect(group).toBeInTheDocument()
    expect(group).toContainElement(screen.getByText('Balanced'))
    expect(group).toContainElement(screen.getByText('Semantic'))
  })

  it('calls onPresetChange with "semantic" when Semantic is clicked', () => {
    const onChange = vi.fn()
    renderWithPreset('balanced', onChange)

    fireEvent.click(screen.getByText('Semantic'))
    expect(onChange).toHaveBeenCalledWith('semantic')
  })

  it('calls onPresetChange with "balanced" when Balanced is clicked', () => {
    const onChange = vi.fn()
    renderWithPreset('semantic', onChange)

    fireEvent.click(screen.getByText('Balanced'))
    expect(onChange).toHaveBeenCalledWith('balanced')
  })

  it('applies active styling to the currently selected preset', () => {
    renderWithPreset('balanced')

    const balanced = screen.getByText('Balanced')
    const semantic = screen.getByText('Semantic')

    expect(balanced.className).toContain('bg-primary')
    expect(balanced.className).toContain('border-primary')
    expect(semantic.className).not.toContain('bg-primary')
  })

  it('applies active styling to Semantic when it is selected', () => {
    renderWithPreset('semantic')

    const balanced = screen.getByText('Balanced')
    const semantic = screen.getByText('Semantic')

    expect(semantic.className).toContain('bg-primary')
    expect(semantic.className).toContain('border-primary')
    expect(balanced.className).not.toContain('bg-primary')
  })

  it('renders Balanced with only left rounding and Semantic with only right rounding (segmented look)', () => {
    renderWithPreset()

    const balanced = screen.getByText('Balanced')
    const semantic = screen.getByText('Semantic')

    // Balanced: rounded-l, no rounded-r
    expect(balanced.className).toContain('rounded-l')
    expect(balanced.className).toContain('rounded-r-none')

    // Semantic: rounded-r, no rounded-l, no left border (shared separator)
    expect(semantic.className).toContain('rounded-r')
    expect(semantic.className).toContain('rounded-l-none')
    expect(semantic.className).toContain('border-l-0')
  })

  it('has no gap between the buttons (directly adjacent)', () => {
    renderWithPreset()

    const balanced = screen.getByText('Balanced')

    // Parent container should be inline-flex with no gap class
    const container = balanced.parentElement!
    expect(container.className).toContain('inline-flex')
    expect(container.className).not.toMatch(/\bgap-\d/)
  })

  it('disables both buttons when embedding is not ready', () => {
    render(
      <SearchBar
        {...defaultProps}
        embeddingStatus="loading"
        searchPreset="balanced"
        onPresetChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Balanced')).toBeDisabled()
    expect(screen.getByText('Semantic')).toBeDisabled()
  })
})
