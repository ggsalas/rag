import { useProcessingCountData } from "@/hooks/data/useProcessingCountData";

export function QueueIndicator() {
  const processingDocs = useProcessingCountData();

  if (!processingDocs) return null;

  return (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <svg
        className="w-4 h-4 animate-spin text-blue-500"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span>
        Processing {processingDocs} document{processingDocs !== 1 ? "s" : ""}
      </span>
    </div>
  );
}
