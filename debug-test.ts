import { filterBoilerplateSections } from './src/services/ingest/section-filter.service'

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

console.log('Input:')
console.log(input)
console.log('\n---\n')

const out = filterBoilerplateSections(input, { enableHeuristic: true })

console.log('Output:')
console.log(out)
console.log('\n---\n')

console.log('Contains "Mixed Section":', out.includes('Mixed Section'))
console.log(
  'Contains "text without a link":',
  out.includes('text without a link'),
)
