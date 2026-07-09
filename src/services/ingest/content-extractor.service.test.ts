import { describe, it, expect } from 'vitest'
import {
  extractMainContent,
  DEFAULT_BOILERPLATE_SECTIONS,
} from './content-extractor.service'

describe('extractMainContent', () => {
  it('returns empty for empty input', () => {
    expect(extractMainContent('')).toBe('')
    expect(extractMainContent('   ')).toBe('')
  })

  it('preserves clean documents without boilerplate sections', () => {
    const input = `## Introduction\n\nSome intro.\n\n## Body\n\nSome body.`
    const out = extractMainContent(input)
    expect(out).toContain('## Introduction')
    expect(out).toContain('Some intro.')
    expect(out).toContain('## Body')
    expect(out).toContain('Some body.')
  })

  it('drops a top-level References section', () => {
    const input =
      `# Article\n\n## Intro\n\nBody content.\n\n` +
      `## References\n\n1. Citation one.\n2. Citation two.\n`
    const out = extractMainContent(input)
    expect(out).toContain('Body content.')
    expect(out).not.toContain('References')
    expect(out).not.toContain('Citation one')
    expect(out).not.toContain('Citation two')
  })

  it('drops nested subsections under a boilerplate heading', () => {
    const input =
      `## Intro\n\nA.\n\n` +
      `## References\n\n### Primary sources\n\nP1.\n\n### Secondary sources\n\nS1.\n\n` +
      `## Legacy\n\nL1.\n`
    const out = extractMainContent(input)
    expect(out).toContain('## Intro')
    expect(out).toContain('A.')
    expect(out).toContain('## Legacy')
    expect(out).toContain('L1.')
    expect(out).not.toContain('References')
    expect(out).not.toContain('Primary sources')
    expect(out).not.toContain('Secondary sources')
    expect(out).not.toContain('P1.')
    expect(out).not.toContain('S1.')
  })

  it('preserves content before the first boilerplate heading', () => {
    const input = `# Article\n\nPre-heading paragraph.\n\n## References\n\nX.`
    const out = extractMainContent(input)
    expect(out).toContain('Pre-heading paragraph.')
    expect(out).not.toContain('References')
    expect(out).not.toContain('X.')
  })

  it('handles Spanish section names', () => {
    const input =
      `## Introducción\n\nCuerpo.\n\n## Referencias\n\n1. Cita.\n\n## Véase también\n\n- Enlace.\n`
    const out = extractMainContent(input)
    expect(out).toContain('## Introducción')
    expect(out).toContain('Cuerpo.')
    expect(out).not.toContain('Referencias')
    expect(out).not.toContain('Véase también')
    expect(out).not.toContain('Cita')
  })

  it('is case-insensitive', () => {
    const inputs = [
      `## References\n\nX.`,
      `## references\n\nX.`,
      `## REFERENCES\n\nX.`,
      `## ReFeReNcEs\n\nX.`,
    ]
    for (const input of inputs) {
      const out = extractMainContent(input)
      expect(out).not.toContain('X.')
    }
  })

  it('respects heading depth: sibling section at same level survives', () => {
    // "## References" ends when the next "## Other" arrives (same level).
    // Content under "## Other" must survive.
    const input =
      `## References\n\nCitation.\n\n## Other Section\n\nSurvivor content.\n`
    const out = extractMainContent(input)
    expect(out).toContain('## Other Section')
    expect(out).toContain('Survivor content.')
    expect(out).not.toContain('Citation.')
  })

  it('handles two boilerplate sections back to back', () => {
    const input =
      `## Body\n\nB.\n\n` +
      `## References\n\nR.\n\n## External links\n\nL.\n\n` +
      `## Epilogue\n\nE.\n`
    const out = extractMainContent(input)
    expect(out).toContain('## Body')
    expect(out).toContain('B.')
    expect(out).toContain('## Epilogue')
    expect(out).toContain('E.')
    expect(out).not.toContain('References')
    expect(out).not.toContain('External links')
    expect(out).not.toContain('R.')
    expect(out).not.toContain('L.')
  })

  it('accepts a custom boilerplate list', () => {
    const input =
      `## Introduction\n\nI.\n\n## Custom Boilerplate\n\nDrop me.\n\n## References\n\nKeep me.\n`
    const custom = new Set(['custom boilerplate'])
    const out = extractMainContent(input, { boilerplateSections: custom })
    expect(out).toContain('## Introduction')
    expect(out).toContain('Keep me.') // "References" is not in the custom set
    expect(out).not.toContain('Custom Boilerplate')
    expect(out).not.toContain('Drop me.')
  })

  it('preserves fenced code blocks with heading-like syntax inside', () => {
    // A "## References" inside a code fence must NOT trigger the section drop,
    // because the walker only looks at top-level heading nodes.
    const input =
      '## Intro\n\nSee example:\n\n```md\n## References\nInside code.\n```\n\n## Body\n\nB.\n'
    const out = extractMainContent(input)
    expect(out).toContain('## Intro')
    expect(out).toContain('## Body')
    expect(out).toContain('## References')
    expect(out).toContain('Inside code.')
  })

  it('is idempotent', () => {
    const input =
      `# Doc\n\n## Body\n\nB.\n\n## References\n\n1. R.\n\n## Legacy\n\nL.\n`
    const once = extractMainContent(input)
    const twice = extractMainContent(once)
    expect(twice).toBe(once)
  })

  it('exports the default blacklist so callers can inspect / extend it', () => {
    expect(DEFAULT_BOILERPLATE_SECTIONS.has('references')).toBe(true)
    expect(DEFAULT_BOILERPLATE_SECTIONS.has('see also')).toBe(true)
    expect(DEFAULT_BOILERPLATE_SECTIONS.has('referencias')).toBe(true)
    expect(DEFAULT_BOILERPLATE_SECTIONS.has('véase también')).toBe(true)
  })
})
