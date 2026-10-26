import { AlertTriangle } from 'lucide-react'
import { useT } from '../lib/useT'
import { cn } from '../lib/utils'
import { Modal } from './ui'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

/** In-app confirmation dialog (Tauri's native confirm shows the tauri.localhost origin). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger = true,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const t = useT()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-ghost px-3 py-1.5 text-xs">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'btn px-3.5 py-1.5 text-xs',
              danger ? 'bg-danger text-white hover:opacity-90' : 'btn-primary',
            )}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3 pb-1">
        <span
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            danger ? 'bg-danger/10 text-danger' : 'bg-accent-soft text-accent',
          )}
        >
          <AlertTriangle size={16} />
        </span>
        <p className="pt-1 text-[12.5px] leading-relaxed text-muted">{message}</p>
      </div>
    </Modal>
  )
}
