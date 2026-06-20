import { useState, useEffect } from "react";
import { db } from "@/services/db";
import type { DocumentStatus } from "@/types/document";

const PROCESSING_STATUSES: DocumentStatus[] = [
  "pending",
  "parsing",
  "chunking",
  "embedding",
];

/**
 * Hook to check if there are any documents currently being processed.
 * Returns true if any document has a processing status.
 */
export function useProcessingDocuments(): boolean {
  const [hasProcessing, setHasProcessing] = useState(false);

  useEffect(() => {
    let mounted = true;

    const checkProcessing = async () => {
      const count = await db.documents
        .filter((doc) => PROCESSING_STATUSES.includes(doc.status))
        .count();

      if (mounted) {
        setHasProcessing(count > 0);
      }
    };

    // Check immediately
    checkProcessing();

    // Check periodically (every 2 seconds)
    const interval = setInterval(checkProcessing, 2000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return hasProcessing;
}
