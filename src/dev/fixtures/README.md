# QASPER Benchmark Fixtures

Two academic papers from the QASPER dataset (Question Answering on Scientific Papers), converted to Markdown for benchmarking the RAG retrieval pipeline.

## Attribution

**Dataset**: QASPER — A Question Answering Dataset for Scientific Papers
**Authors**: Dasigi et al. (2021)
**License**: CC BY 4.0
**Source**: https://allenai.github.io/qasper/

## Papers

| File | Title | arXiv ID |
|------|-------|----------|
| `qasper-1910_11471.md` | Machine Translation from Natural Language to Code using Long-Short Term Memory | 1910.11471 |
| `qasper-1908_06606.md` | Question Answering based Clinical Text Structuring Using Pre-trained Language Model | 1908.06606 |

## Usage

These fixtures are consumed by `qasper-benchmark.test.ts` to evaluate multi-document retrieval quality. Both papers are loaded into a single library to test cross-document retrieval with realistic distractors.

## Ground Truth

Questions and evidence extracted from QASPER annotations:
- 16 positive cases (questions with `highlighted_evidence` from annotators)
- 3 unanswerable cases (all annotators marked `unanswerable: true`)
- Evidence filtered: `FLOAT SELECTED` references (table/figure pointers) discarded, section-path prefixes stripped, duplicates across annotators removed

## Processing

- Markdown generated from QASPER JSON structure: `section_name` → headings, `paragraphs` → body text
- Chunked via `chunkMarkdown` (CHUNK_SIZE=900, CHUNK_OVERLAP=150)
- Expected ~42 chunks total across both papers
