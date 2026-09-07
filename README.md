# RAG

<div align="center">
  <img src="public/icons/icon.svg" alt="RAG logo" width="80" />
  <p><a href="https://ggsalas.github.io/rag/">https://ggsalas.github.io/rag/</a></p>
</div>

A privacy-first PWA for semantic document search and AI-powered answers that runs entirely in your browser. No backend, no data collection. Your data is processed locally.

## How It Works

Documents are organized into **Libraries** — independent collections, each with its own search index.

### 1. Parsing

When a document is uploaded, its text is extracted according to file type:

| Format   | Parser                                  |
| -------- | --------------------------------------- |
| PDF      | @llamaindex/liteparse-wasm (PDFium)     |
| DOCX     | mammoth                                 |
| TXT / MD | Native browser `File.text()`            |

Parsing runs in a Web Worker to avoid blocking the UI. PDFs are extracted as structured Markdown (headings, lists, tables) so they can flow through the same chunker as native `.md` files. Extracted text is then run through a conservative `sanitize` pass (AST-based via `remark`) that normalizes Unicode (NFKC), strips zero-width characters, and cleans whitespace — without altering document structure. An opt-in `boilerplate-stripper` module handles aggressive noise removal (nav chrome, empty tables, citation markers) for scraped content when enabled per library.

### 2. Chunking & Embedding

The extracted text is split into overlapping chunks by paragraph — each chunk has a configurable size and overlap so context isn't lost at boundaries. Each chunk is then embedded into a vector using a HuggingFace model (`Xenova/all-MiniLM-L6-v2`) running locally via ONNX.

Both chunks and embeddings are persisted in IndexedDB (Dexie) — the source of truth. Orama maintains a derived in-memory vector index per library, rebuilt lazily on first access.

### 3. Hybrid Search

Queries run against Orama using hybrid mode: **semantic** (vector similarity) + **keyword** (BM25). The balance between both modes is adjustable via a slider in the UI.

### 4. AI Answer Mode

An optional toggle in the search bar activates AI Answer mode. The top search results are sent as context to a local LLM (Llama 3.2 1B), which generates a streamed response with numbered citations (`[1]`, `[2]`, ...) linked directly to the source chunks. The model runs via WebGPU using `@mlc-ai/web-llm` — no API key, no network request, fully private. The model (~880 MB) is downloaded once and cached by the browser.

## Tech Stack

| Layer         | Technology                  |
| ------------- | --------------------------- |
| UI            | React 19                    |
| Build         | Vite 8 (Rolldown)           |
| Router        | React Router 7              |
| Styles        | Tailwind CSS 4              |
| State         | Zustand 5                   |
| Database      | Dexie.js 4 (IndexedDB)      |
| Vector Search | Orama 3                     |
| Embeddings    | @huggingface/transformers 4 |
| LLM           | @mlc-ai/web-llm (WebGPU)    |
| Workers       | Comlink 4                   |
| Testing       | Vitest 4                    |
| PWA           | vite-plugin-pwa 1           |

## Development

```bash
npm install
npm run dev
```

```bash
npm test
```

## Architecture

The codebase follows a layered architecture with strict dependency rules. See [AGENTS.md](./AGENTS.md) for details.

See [INGEST.md](./INGEST.md) for the document ingestion pipeline.
