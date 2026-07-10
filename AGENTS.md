# AGENTS.md — RAG

## Project Overview

RAG is a PWA that runs 100% in the browser. It provides local semantic document search and AI-powered answers with zero backend and full privacy. Documents never leave the user's device.

Users organize documents into **Libraries**. Each library is an independent collection with its own documents, chunks, embeddings, and vector search index.

## Tech Stack

| Layer         | Technology                | Version                                         |
| ------------- | ------------------------- | ----------------------------------------------- |
| UI            | React                     | 19.x                                            |
| Bundler       | Vite                      | 8.x (Rolldown)                                  |
| Styles        | Tailwind CSS              | 4.x (CSS-first, no tailwind.config.js)          |
| Router        | React Router              | 7.x (single package, replaces react-router-dom) |
| State         | Zustand                   | 5.x (global state minimum)                      |
| Persistence   | Dexie.js                  | 4.x (IndexedDB wrapper)                         |
| Vector Search | Orama                     | 3.x                                             |
| Embeddings    | @huggingface/transformers | 4.x                                             |
| LLM (AI mode) | @mlc-ai/web-llm           | 0.x (WebGPU, main thread)                       |
| PDF Parsing   | @llamaindex/liteparse-wasm | 2.x (PDFium-based, WASM)                       |
| DOCX Parsing  | mammoth                   | 1.x                                             |
| MD sanitize   | remark (unified)          | 15.x (AST-based, conservative)                 |
| Worker Comms  | Comlink                   | 4.x                                             |
| Testing       | Vitest                    | 4.x                                             |
| PWA           | vite-plugin-pwa           | 1.x                                             |
| Language      | TypeScript                | 5.x (strict mode)                               |

## Directory Structure

```
src/
├── types/           # Shared TypeScript types
├── lib/             # Pure utilities and constants
├── infrastructure/  # External tools setup (DB, vector store, worker access)
├── services/        # Business logic (NO React dependency)
├── workers/         # Web Workers (embedding, parsing)
├── store/           # Zustand global state
├── hooks/           # Custom React hooks
│   └── data/        # Data hooks (ONLY layer allowed to import db directly)
├── components/      # React components (ui/, libraries/, documents/, search/)
└── routes/          # Pages and loaders (React Router)
```

## Architecture Rules (MUST follow)

### Dependency Direction

```
UI (components, routes)
        ↓
  store / hooks
        ↓
  services / workers
        ↓
  infrastructure
```

`types` and `lib` are cross-cutting utilities available to all layers. Never import upward. If you need to, refactor instead.

### Layer Rules

1. **`infrastructure/`** contains setup for external tools (Dexie database, Orama vector store, Comlink worker proxies). It MUST NOT import from `services/`, `workers/`, `components/`, `hooks/`, or `store/`. Infrastructure provides low-level access that services consume.

2. **`services/`** MUST NOT import from `react`, `components/`, `hooks/`, or `store/`.
   Services are pure TypeScript. They receive all needed data as parameters.

3. **`workers/`** run in a separate thread. They MUST NOT import from `services/`, `components/`, `hooks/`, or `store/`. They can only import from `types/` and external libraries.

4. **`hooks/data/`** (Data Hooks) - ARCHITECTURE EXCEPTION: These hooks are the ONLY ones allowed to import from `infrastructure/db` directly. They encapsulate Dexie's `useLiveQuery` for reactive database queries. All data hooks MUST:
   - Be read-only (no create/update/delete operations)
   - Use naming convention: `use[Entity]Data.ts`
   - Be simple queries (filtering, sorting, counting)
   - NOT contain business logic (that goes in business hooks or services)

   ```ts
   // hooks/data/useDocumentsData.ts
   export function useDocumentsData(libraryId: string) {
     const documents = useLiveQuery(
       () => db.documents.where('libraryId').equals(libraryId).sortBy('createdAt'),
       [libraryId],
     )
     return { documents: documents ?? [], loading: documents === undefined }
   }
   ```

   Business hooks consume data hooks for reactive reads, services for writes:

   ```ts
   // hooks/useDocuments.ts
   export function useDocuments(libraryId: string) {
     const { documents, loading } = useDocumentsData(libraryId) // reactive
     const deleteDocument = (id: string) => documentService.deleteDocument(id)
     return { documents, loading, deleteDocument }
   }
   ```

5. **`hooks/`** (Business Hooks) MUST NOT import from `infrastructure/db` directly. They should use data hooks from `hooks/data/` for reactive queries and services for write operations.

6. **`components/`** MUST NOT import from `services/` or `infrastructure/` directly. Use `hooks/` or `hooks/data/` to connect components to data and business logic.

7. **`routes/`** can import from `components/`, `hooks/`, and `services/` (only in loaders/actions).

8. **`store/`** (Zustand) holds ONLY cross-route state:
   - `modelStatus` (embedding model loading state)
   - `llmStatus` / `llmProgress` (LLM model loading state — shared across routes so the model isn't re-downloaded on navigation)
   - `processingQueue` (documents being processed)
   - `stats` (global statistics)

   The current `libraryId` is derived from route params (`useParams()`), NOT stored in Zustand.

### Library Scoping

- Every document and chunk belongs to a `libraryId`.
- Services that operate on documents/chunks receive `libraryId` as a parameter.
- Orama maintains a `Map<libraryId, OramaDB>` — one index per library.
- There is NO cross-library search.

## Routing

```
/                                    → redirect to /libraries
/libraries                           → Library list
/libraries/:libraryId                → redirect to documents
/libraries/:libraryId/documents      → Documents view (scoped to library)
/libraries/:libraryId/search         → Search view (scoped to library)
```

## Data Model

```
Library (1)
  └── Document (N)
        └── Chunk (N)
              └── Embedding (number[], stored in chunk)
```

**Dexie** (IndexedDB) is the source of truth for all data.
**Orama** is a derived in-memory vector index, rebuilt lazily when entering a library.

## File Naming Conventions

| Type            | Pattern                          | Example                    |
| --------------- | -------------------------------- | -------------------------- |
| React component | `PascalCase.tsx`                 | `DropZone.tsx`             |
| Service         | `kebab-case.service.ts`          | `chunking.service.ts`      |
| Hook            | `camelCase.ts` with `use` prefix | `useDocuments.ts`          |
| Type file       | `kebab-case.ts`                  | `document.ts`              |
| Test            | `*.test.ts` or `*.test.tsx`      | `chunking.service.test.ts` |
| Worker          | `kebab-case.worker.ts`           | `embedding.worker.ts`      |
| Loader          | `kebab-case.loader.ts`           | `documents.loader.ts`      |
| Store           | `kebab-case.store.ts`            | `app.store.ts`             |

## Testing

- Tests are **co-located** with source files (NOT in a separate `tests/` folder).
- Use Vitest.
- Priority: test services first (pure business logic).
- Mock Web Workers in tests.
- Use `fake-indexeddb` for Dexie tests.

## Code Style

- TypeScript strict mode enabled.
- Use `export type` for type-only exports.
- Prefer named exports over default exports.
- Use `@/` path alias for imports from `src/`.
- All services use `async/await` (no `.then()` chains).
- Tailwind CSS v4: styles configured via CSS (`@import "tailwindcss"`), NO `tailwind.config.js`.

## Documentation Style

- Use JSDoc comments (`/** */`) for all exported functions and key internal functions.
- Keep comments concise — focus on what the function does, not implementation details.
- Write all code comments in **English**.
- Format: `/** Brief description */`
- Include inline comments (`//`) for complex logic blocks that need clarification.
- Example:
  ```ts
  /** Processes a document through the complete ingestion pipeline */
  async function processDocument(
    docMeta: DocumentMeta,
    file: File,
  ): Promise<void> {
    // Use page-aware chunking if parser extracted page information
    const chunks = parseResult.pages ? chunkWithPages(pages) : chunkText(text)
  }
  ```

## Key Patterns

### Services receive libraryId, they don't know the current route:

```ts
// ✅ Correct
async function search(
  query: string,
  libraryId: string,
  topK?: number,
): Promise<SearchResult[]>

// ❌ Wrong — services must not access router
async function search(query: string): Promise<SearchResult[]> {
  const libraryId = getCurrentRoute().params.libraryId // NEVER do this
}
```

### LLM runs on the main thread via WebGPU:

The LLM service (`src/services/llm/llm.service.ts`) uses `@mlc-ai/web-llm` directly on the main thread — not in a Web Worker. This is intentional: WebGPU inference offloads compute to the GPU, and the JavaScript overhead is minimal. The module-level `engine` singleton ensures the model is loaded only once per session.

```ts
// src/services/llm/llm.service.ts
import { CreateMLCEngine } from '@mlc-ai/web-llm'

let engine: MLCEngine | null = null

export async function initLLMModel(onProgress?: LLMProgressCallback): Promise<void> {
  engine = await CreateMLCEngine(LLM_MODEL_ID, { ... })
}
```

`@mlc-ai/web-llm` must be excluded from Vite's `optimizeDeps` to avoid bundling it twice:
```ts
// vite.config.ts
optimizeDeps: { exclude: ['@mlc-ai/web-llm'] }
```

### Workers are accessed via Comlink proxies:

```ts
// infrastructure/worker-pool.ts
import { wrap, type Remote } from 'comlink'

let parserWorker: Remote<ParserWorkerAPI> | null = null

export function getParserWorker(): Remote<ParserWorkerAPI> {
  if (!parserWorker) {
    const worker = new Worker(
      new URL('@/workers/parser.worker.ts', import.meta.url),
      { type: 'module' },
    )
    parserWorker = wrap<ParserWorkerAPI>(worker)
  }
  return parserWorker
}
```

### Orama is a derived index, not the source of truth:

```ts
// Source of truth: Dexie
await persistenceService.saveChunks(chunks)

// Derived index: Orama (can be rebuilt anytime from Dexie data)
await vectorStore.insertChunks(libraryId, chunks)
```

### Loaders fetch data before rendering:

```ts
// documents.loader.ts
export async function loader({ params }: LoaderFunctionArgs) {
  const documents = await persistenceService.getDocuments(params.libraryId!)
  return { documents }
}

// documents.tsx
function DocumentsPage() {
  const { documents } = useLoaderData<typeof loader>()
  return <DocumentList documents={documents} />
}
```

## What NOT to Do

- ❌ Do NOT install `react-router-dom` — use `react-router` (v7 single package)
- ❌ Do NOT create `tailwind.config.js` — Tailwind v4 uses CSS-first config
- ❌ Do NOT import services directly in components — use hooks
- ❌ Do NOT store `libraryId` in Zustand — derive from route params
- ❌ Do NOT put tests in a separate `tests/` folder — co-locate them
- ❌ Do NOT use `@xenova/transformers` — use `@huggingface/transformers`
- ❌ Do NOT add `@mlc-ai/web-llm` to Vite's `optimizeDeps.include` — keep it excluded to avoid duplicate TVM runtime instances
- ❌ Do NOT access IndexedDB directly — use Dexie
- ❌ Do NOT access Orama from components — go through services
