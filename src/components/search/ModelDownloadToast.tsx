import { useAppStore } from '@/store/app.store'
import { LLM_MODEL_NAME, LLM_MODEL_DOWNLOAD_SIZE } from '@/lib/constants'

/**
 * Live download-progress content rendered inside a sonner toast while the local
 * LLM is being fetched. Subscribes to the store so it re-renders as progress
 * advances. It provides only the inner content — sonner supplies the toast
 * chrome (background, border) and, on success, the check icon.
 */
export function ModelDownloadToast() {
  const progress = useAppStore((s) => s.llmProgress)
  const status = useAppStore((s) => s.llmStatus)
  const done = status === 'ready'
  const value = done ? 100 : progress

  return (
    <div className="w-[320px]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-foreground">
          {done ? 'AI model ready' : 'Downloading AI model…'}
        </span>
        <span className="ml-auto text-sm font-medium text-foreground tabular-nums">
          {value}%
        </span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${value}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {done
          ? 'Finished — cached for next time.'
          : `${LLM_MODEL_NAME} (${LLM_MODEL_DOWNLOAD_SIZE}) — cached after the first download.`}
      </p>
    </div>
  )
}
