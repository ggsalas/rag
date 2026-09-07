import { describe, it, expect } from 'vitest'
import { filterBoilerplateSections } from './section-filter.service'

describe('filterBoilerplateSections', () => {
  it('returns empty string unchanged', () => {
    expect(filterBoilerplateSections('')).toBe('')
    expect(filterBoilerplateSections('   ')).toBe('   ')
  })

  it('removes English "References" section', () => {
    const input = `# Main Content

Some text here.

## References

1. Author A, "Title", 2023
2. Author B, "Another Title", 2024`

    const out = filterBoilerplateSections(input)
    expect(out).toContain('Main Content')
    expect(out).toContain('Some text here')
    expect(out).not.toContain('References')
    expect(out).not.toContain('Author A')
  })

  it('removes English "Bibliography" section', () => {
    const input = `# Content

Text.

## Bibliography

- Book one
- Book two`

    const out = filterBoilerplateSections(input)
    expect(out).toContain('Content')
    expect(out).toContain('Text')
    expect(out).not.toContain('Bibliography')
    expect(out).not.toContain('Book one')
  })

  it('removes English "See also" section', () => {
    const input = `# Article

Content here.

## See also

- [Related article](link)
- [Another article](link)`

    const out = filterBoilerplateSections(input)
    expect(out).toContain('Article')
    expect(out).toContain('Content here')
    expect(out).not.toContain('See also')
  })

  it('removes English "External links" section', () => {
    const input = `# Page

Main content.

### External links

- [Link 1](url)
- [Link 2](url)`

    const out = filterBoilerplateSections(input)
    expect(out).toContain('Page')
    expect(out).toContain('Main content')
    expect(out).not.toContain('External links')
  })

  it('removes Spanish "Referencias" section', () => {
    const input = `# Contenido

Texto aquí.

## Referencias

1. Autor A, "Título", 2023`

    const out = filterBoilerplateSections(input)
    expect(out).toContain('Contenido')
    expect(out).toContain('Texto aquí')
    expect(out).not.toContain('Referencias')
    expect(out).not.toContain('Autor A')
  })

  it('removes Spanish "Véase también" section', () => {
    const input = `# Artículo

Contenido.

## Véase también

- [Artículo relacionado](link)`

    const out = filterBoilerplateSections(input)
    expect(out).toContain('Artículo')
    expect(out).toContain('Contenido')
    expect(out).not.toContain('Véase también')
  })

  it('is case-insensitive', () => {
    const input = `# Content

Text.

## REFERENCES

1. Reference one`

    const out = filterBoilerplateSections(input)
    expect(out).not.toContain('REFERENCES')
    expect(out).not.toContain('Reference one')
  })

  it('removes entire subsection tree under boilerplate heading', () => {
    const input = `# Main

Content.

## References

### Subsection A

More references.

### Subsection B

Even more references.

## Back to Main

This should stay.`

    const out = filterBoilerplateSections(input)
    expect(out).toContain('Main')
    expect(out).toContain('Content')
    expect(out).toContain('Back to Main')
    expect(out).toContain('This should stay')
    expect(out).not.toContain('References')
    expect(out).not.toContain('Subsection A')
    expect(out).not.toContain('Subsection B')
  })

  it('preserves content when no boilerplate sections exist', () => {
    const input = `# Introduction

Intro text.

## Methods

Methods text.

## Results

Results text.`

    const out = filterBoilerplateSections(input)
    expect(out).toContain('Introduction')
    expect(out).toContain('Intro text')
    expect(out).toContain('Methods')
    expect(out).toContain('Methods text')
    expect(out).toContain('Results')
    expect(out).toContain('Results text')
  })

  it('supports custom section names via additionalSections', () => {
    const input = `# Content

Text.

## Appendix

Appendix content.`

    const out = filterBoilerplateSections(input, {
      additionalSections: ['appendix'],
    })
    expect(out).not.toContain('Appendix')
    expect(out).not.toContain('Appendix content')
  })

  it('supports overriding default sections via sections option', () => {
    const input = `# Content

Text.

## References

References content.

## Notes

Notes content.`

    // Only filter "Notes", not "References"
    const out = filterBoilerplateSections(input, {
      sections: ['notes'],
    })
    expect(out).toContain('References')
    expect(out).toContain('References content')
    expect(out).not.toContain('Notes')
    expect(out).not.toContain('Notes content')
  })

  it('handles multiple boilerplate sections', () => {
    const input = `# Article

Content.

## See also

- Related article

## References

1. Reference one

## External links

- [Link](url)`

    const out = filterBoilerplateSections(input)
    expect(out).toContain('Article')
    expect(out).toContain('Content')
    expect(out).not.toContain('See also')
    expect(out).not.toContain('References')
    expect(out).not.toContain('External links')
  })

  it('generic heuristic is disabled by default', () => {
    // Create a section that would match the heuristic (near end, 70%+ links)
    // but is NOT in the default boilerplate list
    const input = `# Main

Content.

## Custom Section

- [Link 1](url1)
- [Link 2](url2)
- [Link 3](url3)
- [Link 4](url4)`

    const out = filterBoilerplateSections(input)
    // Should NOT be removed because heuristic is disabled
    expect(out).toContain('Custom Section')
    expect(out).toContain('Link 1')
  })

  it('generic heuristic removes unknown boilerplate-like section when enabled', () => {
    // Create a section that matches all heuristic criteria:
    // - Near end (last 30%)
    // - At least 3 content blocks (list items count)
    // - >=70% blocks contain links
    // - At least 2 list items
    const input = `# Main Document

This is the main content of the document with substantial text.
More paragraphs here to push the custom section to the end.
Even more content to ensure we're in the last 30%.
Additional filler text.
More filler.
Even more filler.
Lots of filler.
So much filler.
Final filler paragraph.
Even more filler to be safe.
Another filler line.
Yet another one.
One more for good measure.
Final final filler.

## Additional Resources

- [Resource 1](https://example.com/1)
- [Resource 2](https://example.com/2)
- [Resource 3](https://example.com/3)
- [Resource 4](https://example.com/4)`

    const out = filterBoilerplateSections(input, { enableHeuristic: true })
    // Should be removed by heuristic
    expect(out).toContain('Main Document')
    expect(out).toContain('main content')
    expect(out).not.toContain('Additional Resources')
    expect(out).not.toContain('Resource 1')
  })

  it('generic heuristic does NOT remove link-heavy legitimate section', () => {
    // Create a section with links but also substantial content (not list-heavy)
    const input = `# Main

Content.

## Learning Resources

Here are some great resources for learning:

The first resource is [Link 1](url1) which covers basics.
The second resource is [Link 2](url2) which is advanced.
The third resource is [Link 3](url3) which is intermediate.

This section has explanatory text, not just a list of links.`

    const out = filterBoilerplateSections(input, { enableHeuristic: true })
    // Should NOT be removed - has substantial text, not just list items
    expect(out).toContain('Learning Resources')
    expect(out).toContain('great resources')
    expect(out).toContain('explanatory text')
  })

  it('generic heuristic does NOT remove section not near document end', () => {
    // Create a section that matches other criteria but is NOT near the end (before 50% threshold)
    const input = `# Main

## Early Resources

- [Link 1](url1)
- [Link 2](url2)
- [Link 3](url3)
- [Link 4](url4)

## Middle Section

Content here.

## Another Section

More content.

## Final Section

Even more content.

## Last Section

Final content.`

    const out = filterBoilerplateSections(input, { enableHeuristic: true })
    // Should NOT be removed - not in last 50% of document (at ~16.7% position)
    expect(out).toContain('Early Resources')
    expect(out).toContain('Link 1')
  })

  it('generic heuristic does NOT remove section with fewer than 3 blocks', () => {
    const input = `# Main

Content.

## Small Section

- [Link 1](url1)
- [Link 2](url2)`

    const out = filterBoilerplateSections(input, { enableHeuristic: true })
    // Should NOT be removed - fewer than 3 content blocks
    expect(out).toContain('Small Section')
    expect(out).toContain('Link 1')
  })

  it('generic heuristic does NOT remove section with <70% link blocks', () => {
    const input = `# Main

Content here to push the section to the end.
More content.
Even more content.
Additional content.
More filler.
Even more filler.
Lots of filler.
So much filler.
Final filler.
More filler to ensure position.
Even more filler.
Lots more filler.
So much more filler.
Final final filler.
One more line.
Another line.
Yet another line.
Last line of filler.

## Mixed Section

- [Link 1](url1)
- [Link 2](url2)
Some text without a link.
More text without a link.
Even more text.
- [Link 3](url3)`

    const out = filterBoilerplateSections(input, { enableHeuristic: true })
    // Should NOT be removed - less than 70% of blocks contain links
    expect(out).toContain('Mixed Section')
    expect(out).toContain('text without a link')
  })

  it('handles realistic Wikipedia-style document', () => {
    const input = `# Albert Einstein

Albert Einstein was a theoretical physicist.

## Early life

Einstein was born in Germany.

## Career

He developed the theory of relativity.

## Awards

He received the Nobel Prize in 1921.

## See also

- [Theory of relativity](link)
- [Nobel Prize](link)

## References

1. Author A, "Einstein Biography", 2020
2. Author B, "Physics History", 2021

## External links

- [Einstein Archives](link)
- [Nobel Prize official site](link)`

    const out = filterBoilerplateSections(input)

    // Main content preserved
    expect(out).toContain('Albert Einstein')
    expect(out).toContain('theoretical physicist')
    expect(out).toContain('Early life')
    expect(out).toContain('Career')
    expect(out).toContain('Awards')
    expect(out).toContain('Nobel Prize in 1921')

    // Boilerplate removed
    expect(out).not.toContain('See also')
    expect(out).not.toContain('References')
    expect(out).not.toContain('External links')
    expect(out).not.toContain('Author A')
    expect(out).not.toContain('Einstein Archives')
  })
})
