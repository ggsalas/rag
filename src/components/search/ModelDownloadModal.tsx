import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { LLM_MODEL_NAME, LLM_MODEL_DOWNLOAD_SIZE } from '@/lib/constants'

interface ModelDownloadModalProps {
  open: boolean
  onAccept: () => void
  onCancel: () => void
}

/** Confirmation dialog shown before downloading the local LLM used for AI answers. */
export function ModelDownloadModal({
  open,
  onAccept,
  onCancel,
}: ModelDownloadModalProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Enable AI answers"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onAccept}>
            Download &amp; enable
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        AI answers run a language model directly in your browser. This requires a
        one-time download of an additional model,{' '}
        <span className="font-medium text-foreground">{LLM_MODEL_NAME}</span> (
        {LLM_MODEL_DOWNLOAD_SIZE}). It is cached afterwards, so you only download
        it once.
      </p>
    </Modal>
  )
}
