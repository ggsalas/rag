import { describe, it, expect } from 'vitest'
import { generateId, formatFileSize, formatDate } from './utils'

describe('generateId', () => {
  it('should generate a valid UUID', () => {
    const id = generateId()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('should generate unique IDs', () => {
    const id1 = generateId()
    const id2 = generateId()
    expect(id1).not.toBe(id2)
  })
})

describe('formatFileSize', () => {
  it('should format bytes', () => {
    expect(formatFileSize(500)).toBe('500 B')
  })

  it('should format kilobytes', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB')
  })

  it('should format megabytes', () => {
    expect(formatFileSize(2621440)).toBe('2.5 MB')
  })
})

describe('formatDate', () => {
  it('should format a timestamp to a date string', () => {
    const result = formatDate(1700000000000)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})
