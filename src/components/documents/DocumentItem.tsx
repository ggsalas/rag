import type { DocumentMeta } from "@/types/document";
import { formatFileSize, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { useParams, Link } from "react-router";

interface DocumentItemProps {
  document: DocumentMeta;
  confirmDelete: string | null;
  onConfirmDelete: (id: string | null) => void;
  onDelete: (id: string) => Promise<void>;
}

const PROCESSING_STATUSES: DocumentMeta["status"][] = [
  "pending",
  "parsing",
  "chunking",
  "embedding",
];

export function DocumentItem({
  document,
  confirmDelete,
  onConfirmDelete,
  onDelete,
}: DocumentItemProps) {
  const { libraryId } = useParams<{ libraryId: string }>()
  const isProcessing = PROCESSING_STATUSES.includes(document.status);
  const progress = document.processingProgress ?? 0;
  const hasError = document.status === "error";
  const canView = document.status === "indexed";

  const handleDelete = async () => {
    await onDelete(document.id);
    onConfirmDelete(null);
  };

  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-6 py-4 whitespace-nowrap">
          <div className="flex items-center">
            <div className="text-sm font-medium text-gray-900">
              {document.name}
            </div>
          </div>
          {hasError && document.error && (
            <div className="text-xs text-red-600 mt-1">{document.error}</div>
          )}
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <div className="text-sm text-gray-500">
            {formatFileSize(document.size)}
          </div>
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <span
            className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
              document.status,
            )}`}
          >
            {document.status}
          </span>
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          {formatDate(document.createdAt)}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          <div className="flex gap-2 justify-end">
            {canView && (
              <Link to={`/libraries/${libraryId}/documents/${document.id}`}>
                <Button variant="secondary" size="sm">
                  View
                </Button>
              </Link>
            )}
            {confirmDelete === document.id ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onConfirmDelete(null)}
                >
                  Cancel
                </Button>
                <Button variant="danger" size="sm" onClick={handleDelete}>
                  Confirm
                </Button>
              </>
            ) : (
              <Button
                variant="danger"
                size="sm"
                onClick={() => onConfirmDelete(document.id)}
              >
                Delete
              </Button>
            )}
          </div>
        </td>
      </tr>
      {isProcessing && (
        <tr>
          <td colSpan={5} className="p-0 h-1">
            <div className="w-full bg-gray-200 h-1">
              <div
                className="bg-blue-600 h-1 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function getStatusColor(status: DocumentMeta["status"]) {
  switch (status) {
    case "pending":
      return "bg-gray-100 text-gray-800";
    case "parsing":
    case "chunking":
    case "embedding":
      return "bg-yellow-100 text-yellow-800";
    case "indexed":
      return "bg-green-100 text-green-800";
    case "error":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}
