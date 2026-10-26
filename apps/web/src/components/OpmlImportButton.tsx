import { useRef, useState } from 'react'
import { FolderInput, Loader2 } from 'lucide-react'
import { useAppStore } from '../lib/store'
import { useT } from '../lib/useT'
import { cn } from '../lib/utils'
import { ConfirmDialog } from './ConfirmDialog'

interface OpmlImportButtonProps {
  label?: string
  className?: string
  variant?: 'primary' | 'outline' | 'ghost'
}

/** Hidden file input + button that parses an OPML file and imports it. */
export function OpmlImportButton({ label, className, variant = 'outline' }: OpmlImportButtonProps) {
  const t = useT()
  const importOpml = useAppStore((state) => state.importOpml)
  const toast = useAppStore((state) => state.toast)
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ text: string; skipped: number; reason: string } | null>(null)

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const text = await file.text()
      const result = await importOpml(text)
      const skipped = result.skipped.length
      if (result.feeds === 0 && skipped > 0) {
        setPending({ text, skipped, reason: result.skipped[0]?.error ?? '' })
        return
      }
      toast(
        t(skipped > 0 ? 'onboarding.importedSkipped' : 'onboarding.imported', {
          feeds: result.feeds,
          articles: result.articles,
          skipped,
        }),
        skipped > 0 ? 'info' : 'success',
      )
    } catch (error) {
      toast((error as Error).message || t('toast.error'), 'error')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const importUnverified = async (): Promise<void> => {
    if (!pending) return
    const text = pending.text
    setPending(null)
    busyRef.current = true
    setBusy(true)
    try {
      const result = await importOpml(text, { allowUnverified: true })
      toast(t('onboarding.unverifiedImported', { feeds: result.feeds }), 'info')
    } catch (error) {
      toast((error as Error).message || t('toast.error'), 'error')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        // Android's document picker often reports .opml as
        // application/octet-stream, so extension-only filters hide the file.
        accept={/Android/i.test(navigator.userAgent) ? '*/*' : '.opml,.xml,text/xml,application/xml'}
        className="hidden"
        disabled={busy}
        onChange={(event) => void onFile(event)}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'btn px-3 py-1.5 text-xs',
          variant === 'primary' && 'btn-primary',
          variant === 'outline' && 'btn-outline',
          variant === 'ghost' && 'btn-ghost',
          className,
        )}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <FolderInput size={13} />}
        {label ?? t('settings.data.import')}
      </button>
      <ConfirmDialog
        open={Boolean(pending)}
        title={t('onboarding.unverifiedTitle')}
        message={
          `${t('onboarding.unverifiedMessage', { n: pending?.skipped ?? 0 })}` +
          (pending?.reason ? `（${pending.reason}）` : '')
        }
        confirmLabel={t('onboarding.unverifiedConfirm')}
        danger={false}
        onClose={() => setPending(null)}
        onConfirm={() => void importUnverified()}
      />
    </>
  )
}
