import type { GradedBenchmarkCase } from './search-benchmark.types'

/**
 * Britney Spears PDF corpus benchmark dataset — v2 (fragment-based, graded).
 *
 * Ground truth is defined by literal text fragments from the source document
 * (`britnet-corpus.json` → `documents[0].content`). A chunk is relevant if it
 * contains any fragment (substring match after NFC normalization and whitespace
 * collapsing). When a chunk matches multiple fragments, it takes the max grade.
 *
 * Relevance grades:
 *   2 = the fragment directly answers the query
 *   1 = the fragment provides useful context but is not the core answer
 *
 * This design is robust to chunking strategy changes: whether the pipeline
 * produces 104 or 166 chunks, the relevance labels remain consistent because
 * they are anchored to the source text, not to chunk boundaries.
 *
 * Cases that the source document cannot answer are tracked separately in
 * `UNANSWERABLE_SOURCE_CASES_V2` — they are NOT included in `POSITIVE_CASES_V2`
 * so they do not penalise Hit/Recall/nDCG metrics.
 */

export const POSITIVE_CASES_V2: GradedBenchmarkCase[] = [
  {
    id: 'debut-single',
    query: "What was Britney Spears' debut single?",
    fragments: [
      { text: 'Her debut single, "...Baby One More Time"', grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: 'first-album',
    query: 'When did Britney release her first album?',
    fragments: [
      { text: 'Jive released her debut album', grade: 2 },
      { text: 'January 1999', grade: 1 },
    ],
    kind: 'positive',
  },
  {
    id: 'spouse-marriage',
    query: 'Who did Britney Spears marry in 2004?',
    fragments: [
      { text: 'In July 2004, Spears became engaged to', grade: 2 },
      { text: 'wedding ceremony on September 18, 2004', grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: 'las-vegas-residency',
    query: "What was Britney's Las Vegas residency called?",
    fragments: [
      { text: 'concert residency at Planet Hollywood', grade: 2 },
      { text: 'Vegas, titled Britney: Piece of Me', grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: 'conservatorship-ended',
    query: "When did Britney Spears's conservatorship end?",
    // Three alternative grade-2 fragments on purpose: the fact appears in two
    // places in the article (the legal proceeding and the immediate context),
    // so having three independent fragments makes the label robust to chunking
    // changes — at least one will land in a relevant chunk regardless of where
    // the chunker splits.
    fragments: [
      { text: 'dissolution in', grade: 2 },
      { text: '2021, after she publicly testified', grade: 2 },
      { text: 'Penny terminated Spears', grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: 'toxic-album',
    query: 'Which album contains the song Toxic?',
    fragments: [
      { text: 'fourth studio album, In the Zone, in November', grade: 2 },
      { text: 'The album produced four singles:', grade: 1 },
    ],
    kind: 'positive',
  },
  {
    id: 'birthplace',
    query: 'Where and when was Britney Spears born?',
    fragments: [
      { text: 'Britney Jean Spears was born on December 2, 1981', grade: 2 },
      { text: 'McComb, Mississippi', grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: 'second-album',
    query: "What was Britney Spears' second studio album?",
    fragments: [
      { text: 'second Jive album, was released in May 2000', grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: 'head-shaving',
    query: 'What happened to Britney Spears in February 2007?',
    fragments: [
      { text: 'she shaved her head with electric clippers', grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: 'comeback-album',
    query: "What was Britney's 2008 comeback album and lead single?",
    fragments: [
      { text: 'Circus, was released in December 2008', grade: 2 },
      { text: 'lead single, "Womanizer"', grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: 'father-conservator',
    query: "Who was Britney Spears's father and conservator?",
    // OPTIMIZATION.md excluded this case erroneously as a "parser gap". The
    // fact is verified to be present in the article body: the text explicitly
    // states that her father Jamie filed a temporary conservatorship suit and
    // names him as James "Jamie" Parnell Spears. This is NOT a parsing defect.
    fragments: [
      { text: 'her father Jamie filed a temporary conservatorship suit', grade: 2 },
      { text: 'James "Jamie" Parnell Spears', grade: 1 },
    ],
    kind: 'positive',
  },
  {
    id: 'crossroads-film',
    query: 'What film did Britney Spears star in in 2002?',
    fragments: [
      { text: 'landed her first starring role in Crossroads', grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: 'ninth-album',
    query: "What was Britney Spears's ninth studio album?",
    fragments: [
      { text: 'ninth studio album, Glory', grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: 'departure-2024',
    query: 'When did Britney Spears announce her departure from the music industry?',
    fragments: [
      { text: 'announced her departure from the music industry in 2024', grade: 2 },
    ],
    kind: 'positive',
  },
]

/**
 * Cases the source document cannot answer — excluded from the runnable benchmark.
 *
 * `children-sons` asks for Britney Spears's sons' names. The source does not
 * state them in its body content: "Sean Preston" and "Jayden James" have zero
 * occurrences in the article text. The question is simply unanswerable from
 * this source.
 */
export const UNANSWERABLE_SOURCE_CASES_V2: GradedBenchmarkCase[] = [
  {
    id: 'children-sons',
    query: "What are the names of Britney Spears's sons?",
    fragments: [],
    kind: 'positive',
  },
]

export const NEGATIVE_CASES_V2: GradedBenchmarkCase[] = [
  {
    id: 'neg-capital-france',
    query: 'What is the capital of France?',
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'neg-photosynthesis',
    query: 'How does photosynthesis work?',
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'neg-world-cup-2018',
    query: 'Who won the 2018 FIFA World Cup?',
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'neg-thermodynamics',
    query: 'What are the laws of thermodynamics?',
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'neg-hamlet-author',
    query: 'Who wrote the play Hamlet?',
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'neg-hamlet-author-short',
    query: 'Who wrote Hamlet?',
    fragments: [],
    kind: 'negative',
  },
]

/** Combined v2 dataset for convenience */
export const BRITNEY_BENCHMARK_V2: GradedBenchmarkCase[] = [
  ...POSITIVE_CASES_V2,
  ...NEGATIVE_CASES_V2,
]
