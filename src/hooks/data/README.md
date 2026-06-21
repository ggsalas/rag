# Data Hooks

This directory contains **data hooks** - the only React hooks authorized to import `db` directly.

## Purpose

Encapsulate Dexie's `useLiveQuery` for reactive database queries while maintaining clean architecture.

## Architecture Exception

```
types → lib → infrastructure → services → data-hooks → hooks → components → routes
                                              ↓
                                            db (only data-hooks)
```

**Rule:** Only hooks in `hooks/data/` can import from `@/infrastructure/db`.

## Rules

### ✅ Allowed in data hooks
- Import `db` from `@/infrastructure/db`
- Use `useLiveQuery` for reactive queries
- Simple read-only queries (filtering, sorting, counting)
- Return data + loading state

### ❌ Forbidden in data hooks
- Business logic (use business hooks in `hooks/`)
- Write operations like create/update/delete (use services)
- Side effects (navigation, toasts, API calls)
- Complex data transformations (use business hooks/services)

## Naming Convention

`use[Entity]Data.ts` - e.g.:
- `useDocumentsData.ts`
- `useLibrariesData.ts`
- `useProcessingCountData.ts`
- `useChunkData.ts`

## Example

```ts
// hooks/data/useDocumentsData.ts
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/infrastructure/db'
import type { DocumentMeta } from '@/types/document'

/**
 * Data hook: Reactive query for documents by library.
 * ⚠️ Exception: This hook can import db directly (useLiveQuery requirement).
 */
export function useDocumentsData(libraryId: string) {
  const documents = useLiveQuery(
    () => db.documents
      .where('libraryId')
      .equals(libraryId)
      .reverse()
      .sortBy('createdAt'),
    [libraryId]
  )

  return {
    documents: documents ?? [],
    loading: documents === undefined,
  }
}
```

## Usage in Business Hooks

```ts
// hooks/useDocuments.ts
import { useDocumentsData } from './data/useDocumentsData'
import * as documentService from '@/services/document.service'

export function useDocuments(libraryId: string) {
  const { documents, loading } = useDocumentsData(libraryId)  // ✅ Reactive data
  
  const deleteDocument = async (id: string) => {
    await documentService.deleteDocument(id)
    // No refetch needed - useLiveQuery updates automatically
  }
  
  return { documents, loading, deleteDocument }
}
```

## Usage in Components

```tsx
// Simple case: use data hook directly
import { useProcessingCountData } from '@/hooks/data/useProcessingCountData'

export function QueueIndicator() {
  const count = useProcessingCountData()
  return <div>{count} processing</div>
}

// Complex case: use business hook
import { useDocuments } from '@/hooks/useDocuments'

export function DocumentList() {
  const { documents, loading, deleteDocument } = useDocuments(libraryId)
  // ...
}
```

## Testing

Mock data hooks in tests:

```ts
vi.mock('@/hooks/data/useDocumentsData', () => ({
  useDocumentsData: () => ({
    documents: mockDocuments,
    loading: false,
  })
}))
```

## Migration Guide

If you need to change the database (e.g., from Dexie to another solution):

1. Update hooks in `hooks/data/*` to use new DB API
2. Update `infrastructure/db.ts`
3. Business hooks, components, and routes remain unchanged ✅

---

**Remember:** This is the ONLY place in the UI layer that can import `db`. Keep it clean and simple.
