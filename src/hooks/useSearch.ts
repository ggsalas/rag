import { useState, useCallback, useRef } from "react";
import { search as searchService } from "@/services/search/search.service";
import type { SearchResult } from "@/types/search";

/** Hook for performing semantic search within a library */
export function useSearch(libraryId: string) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const abortRef = useRef(0);

  const performSearch = useCallback(
    async (searchQuery: string) => {
      const trimmed = searchQuery.trim();
      setQuery(searchQuery);

      if (!trimmed) {
        setResults([]);
        setError(null);
        setHasSearched(false);
        return;
      }

      const searchId = ++abortRef.current;
      setIsSearching(true);
      setError(null);

      try {
        const searchResults = await searchService(trimmed, libraryId);

        // Only update if this is still the latest search
        if (searchId === abortRef.current) {
          setResults(searchResults);
          setHasSearched(true);
        }
      } catch (err) {
        if (searchId === abortRef.current) {
          setError(err instanceof Error ? err.message : "Search failed");
          setResults([]);
          setHasSearched(true);
        }
      } finally {
        if (searchId === abortRef.current) {
          setIsSearching(false);
        }
      }
    },
    [libraryId],
  );

  const clearResults = useCallback(() => {
    setQuery("");
    setResults([]);
    setError(null);
    setHasSearched(false);
    abortRef.current++;
  }, []);

  return {
    query,
    results,
    isSearching,
    error,
    hasSearched,
    search: performSearch,
    clearResults,
  };
}
