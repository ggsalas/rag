# Document Ingestion Pipeline — TARGET PROPOSAL (NOT YET IMPLEMENTED)

> **Status: proposal only — no application code has been implemented or
> changed.** This is an approved *target* design; current production behavior
> differs (e.g. DOCX is still parsed via Mammoth). Missing items are *proposed*.

**Scope:** the end-to-end target pipeline from upload to search availability;
status/progress/error handling is shared orchestration wrapping every path.

---

## 1. Two canonical downstream formats

The pipeline recognizes exactly two canonical text formats, chosen by the
*content format* of the parsed input:

| Canonical format | Meaning                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `markdown`       | Simplified Markdown: heading markers (`#`, `##`, …) plus a plain body. Inline formatting and link destinations stripped; visible link label retained. |
| `text`           | Literal plain text. **Never** parsed as Markdown, never treated as structured.                                |

Source adapters (file type → canonical format):

| Source              | Target behavior                                                            |
| ------------------- | ---------------------------------------------------------------------------- |
| **PDF**             | Parsed to Markdown. PDF is **only** a source adapter (PDF → Markdown); nothing downstream is PDF-aware. → `markdown` |
| **`.md` / `.markdown`** | Read into the Markdown route. → `markdown`                               |
| **`.txt`**          | Read into the text route. → `text`                                         |
| **DOC / DOCX**      | **Rejected** in the target at validation (no downstream path).               |

---

## 2. Flow

**One route per file — the branches are mutually exclusive.** For any single
file, the Markdown and Text routes are *alternatives*: exactly one runs, never
both, never in parallel for the same file. Multiple *files* may process
concurrently through the existing queue, each on its own single route; they
converge only after chunking, at the shared embed → persist → index stages.

```
                         +-----------------+
                         |   Upload file   |
                         +--------+--------+
                                  |
                         Validate file type
                     (DOC / DOCX → rejected here)
                                  |
                    +-------------+-------------+
                    | Select ONE route per file |
                    +-------------+-------------+
                                  |
               +------------------+------------------+
               |                  |                  |
              PDF                .md                .txt
               |                  |                  |
       Parse PDF to MD      Read as MD        Read as plain text
               |                  |                  |
               +--------+---------+                  |
                        |                            |
                        v                            v
              MARKDOWN ROUTE                  TEXT ROUTE
              - sanitize/filter               - normalize whitespace
              - extract headings first        - no Markdown parsing
              - strip inline markup/URLs      - no heading inference
              - preserve headings/labels
                        |                            |
                        v                            v
              Markdown chunker               Text chunker
              sections/blocks                paragraphs
              overlap within section         controlled overlap
                        |                            |
                        +-------------+--------------+
                                      |
                             Embed text + heading path
                                      |
                             Persist body/chunks in Dexie
                                      |
                             Insert chunks into Orama
                                      |
                                Search available
```

After the merge point the stages are shared and identical for both routes
(embed → Dexie → Orama → `indexed`); status/progress/error handling wrap the
whole pipeline:

| Status      | Covers                                                       |
| ----------- | -------------------------------------------------------------- |
| `parsing`   | validation + source adapter                                    |
| `chunking`  | normalize + filter + chunk + save document body                |
| `embedding` | embedding text build + `embedBatch`                            |
| `indexed`   | chunks in Dexie, Orama insert done, search available           |

A failure at any stage sets `error`, records the message, clears progress, and
lets the rest of the queue continue. Orama is a **derived** index, always
rebuildable from Dexie — never the source of truth.

---

## 3. Key invariant — extract headings before flattening

> **Recognize and extract headings BEFORE flattening inline markup.** The
> heading hierarchy is carried per chunk as `sectionPath` / `headingText`.

- Content belongs to the **last recognized heading** above it; text before the
  first heading gets an **empty / root** `sectionPath`. All recognized heading
  levels and hierarchy are kept as `sectionPath`/`headingText`; detected
  heading structure is **never dropped**.
- **PDF heading detection is heuristic** and cannot guarantee every visually
  distinct heading is recognized. A missed heading leaves its content under the
  active (last recognized) section until the next recognized heading — stable,
  not an error. Strict accuracy would require a **review/correction step**
  (proposed; not part of the automated pipeline).

## 4. Markdown route — normalization order

1. **Sanitize** (conservative; structure untouched).
2. Run **malformed-layout** filters and **named/heuristic boilerplate** filters
   (References / Bibliography and similar) **before** flattening — filtering on
   intact structure is more reliable than on flattened text.
3. **Extract headings** (§3), then **flatten**: remove inline bold/italic/
   underline markers and link destinations, **keep the visible link label**;
   simplify to `#` markers + plain body.
4. **Keep paragraph / list / table boundaries** where they carry semantics.

**The TXT route gets none of this:** whitespace/newline normalization only —
no Markdown AST, no filtering, no heading inference.

## 5. Chunking (format-specific)

**Markdown chunker** — sections → blocks → paragraphs. Because all syntax was
flattened after heading extraction, **no Markdown syntax can be broken** by a
chunk boundary. Keep link-label units together when feasible; if one
indivisible semantic unit exceeds the budget, allow a **soft oversize** rather
than split it. **Overlap stays within one section and never crosses a heading.**

**Text chunker** — packs **whole paragraphs**; an oversized paragraph splits at
sentence / whitespace boundaries; **overlap is anchored to paragraph/sentence
boundaries**.

**Budget** — chunk size must respect the embedding model's **MiniLM 256-token
input limit, including the `sectionPath` prefix** prepended to the text. The
current `CHUNK_SIZE = 900` / `CHUNK_OVERLAP = 200` characters are **baselines
for re-tuning, not a target word specification**.

## 6. Representations, viewer & indexing

- **Viewer:** shows the **normalized plain text** body with headings as plain
  heading lines — no Markdown re-rendering; the **full normalized body is saved
  to `documentContents`**.
- **Offsets:** must be **relative to the exact normalized body**, or adjusted /
  removed. Never apply normalized-chunk offsets onto an unnormalized source.
- **`text` vs `searchText`:** once flattened, the two **may collapse into one**
  when identical — a target simplification only; **removing either field is
  NOT implemented**.
- **Indexing usage:**
  - Embeddings: input is **`sectionPath` prefixed** to the chunk text.
  - Orama **BM25** indexes **`searchText` + `headingText`** (two properties;
    `sectionPath` is *not* concatenated into the BM25 `searchText`).
  - **Lexical reranker** uses **`headingText` + `sectionPath`**.

## 7. Proposed service tree

All names and paths below are **proposed organization, not the current code**:

```
src/
├── services/
│   ├── ingest/
│   │   ├── ingest.service.ts                 # shared lifecycle/orchestration
│   │   ├── source/
│   │   │   ├── parse-file.service.ts         # validate + dispatch to source adapter
│   │   │   └── pdf-parser.service.ts         # Comlink adapter only
│   │   ├── markdown/
│   │   │   ├── normalize-markdown.service.ts # extract sections / filter / flatten inline syntax
│   │   │   ├── malformed-layout-filter.service.ts
│   │   │   ├── section-filter.service.ts
│   │   │   └── markdown-chunker.service.ts
│   │   ├── text/
│   │   │   ├── normalize-text.service.ts
│   │   │   └── text-chunker.service.ts
│   │   └── ingestion.types.ts                # ParsedContent / ChunkData
│   ├── embedding/                            # existing shared embedding + Orama services
│   └── document.service.ts                   # shared persistence/status
└── workers/
    ├── pdf-parser.worker.ts                  # PDF-only LiteParse worker
    └── embedding.worker.ts                   # shared embeddings
```

**Migration order:** the proposal can first be realized as **behavior changes
in the current paths** (`parser.service.ts`, `chunking.service.ts`, filters…);
**file moves/renames come second** and are pure reorganization.

**Hard removal boundary (PDF):** removing PDF support means deleting only the
PDF adapter, the PDF worker, the parser dispatch branch, the parser dependency,
and its upload acceptance. Markdown/text normalization + chunking and the
shared embed / persist / search stages stay **unchanged** — they never import
the PDF package. The legacy **DOCX Mammoth branch and dependency are removable
the same way** (DOCX is rejected in the target).

## 8. Evaluation in `src/dev`

- **`qasper-benchmark.test.ts`** already compares Markdown chunking against
  `chunkText` **after stripping heading lines** — useful for measuring
  **heading-loss risk**, but **NOT the target candidate** (the target preserves
  headings, §3).
- **`hybrid-benchmark.test.ts`** runs on **`britnet-corpus.json`** with graded
  ground truth and reports **nDCG / Hit / Recall**.
- **`search-benchmark.sanity.test.ts`** checks **evidence coverage** (relevant
  fragments still present in chunks).
- **Ingest diagnostics** cover structure, filters, links, offsets, chunk sizes.

**Limitations:** all fixtures are **Markdown / exported content** — there is no
test of actual PDF → LiteParse extraction. For the desired A/B, **inject the
target normalizer/chunker** into the benchmark and compare the **same sources,
queries, and config**, tracking **nDCG@10, Hit@10, Recall@10, per-query deltas,
heading preservation, and evidence coverage**. Per `src/dev/README.md`,
**clear the caches first** or stale embeddings distort metrics:

```bash
rm -rf src/dev/fixtures/.embedding-cache src/dev/fixtures/.qasper-cache
```

Commands (heavy suites are env-gated and skipped otherwise):

```bash
HYBRID_BENCHMARK=1 npx vitest run --environment node --reporter=verbose src/dev/benchmarks/search/hybrid-benchmark.test.ts
QASPER_BENCHMARK=1 npx vitest run --environment node --reporter=verbose src/dev/benchmarks/search/qasper-benchmark.test.ts
```

These benchmarks are **heavy and gated** and **were not run** for this document
update. Normal verification: `npx vitest run`, `npm run typecheck`, `npm run build`.

## 9. Adoption impact

**No code has been implemented or changed; this is a target proposal.** After
adoption, **existing documents must be reprocessed** (re-chunked,
re-embedded, re-indexed): stored chunks and embeddings do not update
themselves, and Orama is rebuilt from whatever Dexie holds.
