# RAG

<div align="center">
  <img src="public/icons/icon.svg" alt="RAG logo" width="80" />
  <p><a href="https://ggsalas.github.io/rag/">https://ggsalas.github.io/rag/</a></p>
</div>

A privacy-first PWA for semantic document search that runs 100% in the browser. No backend, no data collection—everything stays on your device.

## Architecture Overview

RAG follows a **layered architecture** with strict dependency rules to maintain clean separation of concerns.

### Dependency Flow

```
types → lib → infrastructure → services/workers → store/hooks → components → routes
```

**Rule:** Each layer can only import from layers to its left. Never import against this direction.

### Directory Structure

```
src/
├── types/              # TypeScript type definitions
├── lib/                # Pure utilities (formatters, helpers, constants)
├── infrastructure/     # External tools configuration (DB, vector store, worker access)
├── services/           # Business logic (pure TypeScript, no React)
├── workers/            # Web Workers code (runs in separate threads)
├── store/              # Global state (Zustand)
├── hooks/              # Custom React hooks (bridge between UI and services)
│   └── data/           # Data hooks (only layer allowed to import db for useLiveQuery)
├── components/         # React UI components
└── routes/             # Pages and route loaders (React Router v7)
```

### Layer Responsibilities

| Layer              | Purpose                                         | Can Import From                                   | Cannot Import From                                              |
| ------------------ | ----------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| **types**          | Shared TypeScript interfaces and types          | -                                                 | Everything else                                                 |
| **lib**            | Pure utility functions, no side effects         | `types`                                           | Everything else                                                 |
| **infrastructure** | DB setup, vector store config, worker proxies   | `types`, `lib`                                    | `services`, `workers`, `store`, `hooks`, `components`, `routes` |
| **services**       | Business logic, data operations                 | `types`, `lib`, `infrastructure`                  | `react`, `workers`, `store`, `hooks`, `components`, `routes`    |
| **workers**        | Heavy computations in separate threads          | `types`, external libs                            | `services`, `store`, `hooks`, `components`, `routes`            |
| **store**          | Global state (model status, processing queue)   | `types`, `lib`                                    | `services`, `workers`, `components`, `routes`                   |
| **hooks/data**     | Reactive DB queries (useLiveQuery) ⚠️ Exception | `types`, `lib`, `infrastructure/db`               | `services`, `workers`, `store`, `components`, `routes`          |
| **hooks**          | Business hooks (actions + logic)                | `types`, `lib`, `services`, `store`, `hooks/data` | `infrastructure`, `components`, `routes`                        |
| **components**     | React UI components                             | `types`, `lib`, `hooks`, `hooks/data`, `store`    | `infrastructure`, `services`, `workers`, `routes`               |
| **routes**         | Pages, loaders, actions                         | Everything                                        | -                                                               |

### Key Architectural Patterns

#### 1. Services are Pure TypeScript

Services contain business logic and receive all needed data as parameters:

```ts
// ✅ Correct - service receives libraryId
async function searchDocuments(
  query: string,
  libraryId: string,
): Promise<SearchResult[]>

// ❌ Wrong - service accessing router/store
async function searchDocuments(query: string): Promise<SearchResult[]> {
  const libraryId = useParams().libraryId // NEVER do this
}
```

#### 2. Components Use Hooks, Not Services

Components never import from `services/` directly. Use hooks as the bridge:

```ts
// hooks/useSearch.ts
export function useSearch(libraryId: string) {
  const [results, setResults] = useState<SearchResult[]>([])

  const search = useCallback(
    async (query: string) => {
      const data = await searchService.search(query, libraryId)
      setResults(data)
    },
    [libraryId],
  )

  return { results, search }
}

// components/SearchBox.tsx
function SearchBox() {
  const { libraryId } = useParams()
  const { results, search } = useSearch(libraryId)
  // ...
}
```

#### 3. Library Scoping

Every entity (document, chunk, embedding) belongs to a `libraryId`:

- Libraries are independent collections
- No cross-library operations
- Orama maintains one index per library: `Map<libraryId, OramaDB>`

#### 4. Data Persistence

- **Dexie (IndexedDB)** is the source of truth
- **Orama** is a derived in-memory vector index, rebuilt lazily when entering a library
- Operations: write to Dexie first, then update Orama

## Tech Stack

| Layer         | Technology                  |
| ------------- | --------------------------- |
| UI            | React 19                    |
| Build         | Vite 8 (Rolldown)           |
| Router        | React Router 7              |
| Styles        | Tailwind CSS 4 (CSS-first)  |
| State         | Zustand 5                   |
| Database      | Dexie.js 4 (IndexedDB)      |
| Vector Search | Orama 3                     |
| Embeddings    | @huggingface/transformers 4 |
| PDF/DOCX      | pdfjs-dist 6, mammoth 1     |
| Workers       | Comlink 4                   |
| Testing       | Vitest 4                    |
| PWA           | vite-plugin-pwa 1           |

## File Naming Conventions

- React components: `PascalCase.tsx` (e.g., `DropZone.tsx`)
- Services: `kebab-case.service.ts` (e.g., `chunking.service.ts`)
- Hooks: `camelCase.ts` with `use` prefix (e.g., `useDocuments.ts`)
- Types: `kebab-case.ts` (e.g., `document.ts`)
- Workers: `kebab-case.worker.ts` (e.g., `embedding.worker.ts`)
- Tests: co-located `*.test.ts` or `*.test.tsx`

## Development

```bash
npm install
npm run dev
```

## Testing

```bash
npm test
```

Tests are co-located with source files. Priority: test services first (pure business logic).

---

For detailed architectural rules and patterns, see [AGENTS.md](./AGENTS.md).
