import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useAppStore } from '../lib/store'
import { cn } from '../lib/utils'

export function Toasts() {
  const toasts = useAppStore((state) => state.toasts)
  const dismiss = useAppStore((state) => state.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex flex-col items-center gap-2 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)] lg:pt-3">
      {toasts.map((toast) => {
        const Icon = toast.kind === 'error' ? AlertCircle : toast.kind === 'success' ? CheckCircle2 : Info
        return (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] shadow-lg backdrop-blur animate-pop-in',
              toast.kind === 'error'
                ? 'border-danger/30 bg-surface text-danger'
                : 'border-line bg-surface/95 text-fg',
            )}
            role="status"
          >
            <Icon
              size={15}
              className={cn(
                'mt-px shrink-0',
                toast.kind === 'error' ? 'text-danger' : toast.kind === 'success' ? 'text-success' : 'text-accent',
              )}
            />
            <span className="leading-relaxed">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="ml-1 mt-px shrink-0 text-subtle transition-colors hover:text-fg"
              aria-label="关闭"
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
