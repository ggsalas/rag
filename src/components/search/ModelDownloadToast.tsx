import { useAppStore, type AppState } from '@/store/app.store'
import {
  LLM_MODEL_NAME,
  LLM_MODEL_DOWNLOAD_SIZE,
  EMBEDDING_MODEL_DISPLAY_NAME,
  EMBEDDING_MODEL_DOWNLOAD_SIZE,
} from '@/lib/constants'

type ModelKind = 'llm' | 'embedding'

interface ModelConfig {
  busyLabel: string
  doneLabel: string
  name: string
  size: string
  selectProgress: (s: AppState) => number
  selectStatus: (s: AppState) => AppState['embeddingStatus']
}

const CONFIG: Record<ModelKind, ModelConfig> = {
  llm: {
    busyLabel: 'Downloading AI model…',
    doneLabel: 'AI model ready',
    name: LLM_MODEL_NAME,
    size: LLM_MODEL_DOWNLOAD_SIZE,
    selectProgress: (s) => s.llmProgress,
    selectStatus: (s) => s.llmStatus,
  },
  embedding: {
    busyLabel: 'Downloading embedding model…',
    doneLabel: 'Embedding model ready',
    name: EMBEDDING_MODEL_DISPLAY_NAME,
    size: EMBEDDING_MODEL_DOWNLOAD_SIZE,
    selectProgress: (s) => s.embeddingProgress,
    selectStatus: (s) => s.embeddingStatus,
  },
}

/**
 * Live download-progress content rendered inside a sonner toast while a local
 * model is being fetched. Subscribes to the store so it re-renders as progress
 * advances (sonner renders the toast only once). It provides only the inner
 * content — sonner supplies the toast chrome and, on success, the check icon.
 */
export function ModelDownloadToast({ model }: { model: ModelKind }) {
  const config = CONFIG[model]
  const progress = useAppStore(config.selectProgress)
  const status = useAppStore(config.selectStatus)
  const done = status === 'ready'
  const value = done ? 100 : progress

  return (
    <div className="w-[320px]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-foreground">
          {done ? config.doneLabel : config.busyLabel}
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
          : `${config.name} (${config.size}) — cached after the first download.`}
      </p>
    </div>
  )
}
