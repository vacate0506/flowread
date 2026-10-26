import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Plus, Rss } from 'lucide-react'
import { useAppStore } from '../lib/store'
import { useT } from '../lib/useT'
import { Modal, Spinner } from './ui'

const SAMPLES = [
  { labelKey: 'add.sample.solidot', url: 'https://www.solidot.org/index.rss' },
  { labelKey: 'add.sample.hn', url: 'https://news.ycombinator.com/rss' },
  { labelKey: 'add.sample.ruanyifeng', url: 'http://www.ruanyifeng.com/blog/atom.xml' },
  { labelKey: 'add.sample.antfu', url: 'https://antfu.me/feed.xml' },
]

export function AddFeedModal() {
  const t = useT()
  const navigate = useNavigate()
  const open = useAppStore((state) => state.addFeedOpen)
  const setOpen = useAppStore((state) => state.setAddFeedOpen)
  const folders = useAppStore((state) => state.folders)
  const settings = useAppStore((state) => state.settings)
  const addFeed = useAppStore((state) => state.addFeed)
  const toast = useAppStore((state) => state.toast)

  const [url, setUrl] = useState('')
  const [folderId, setFolderId] = useState('')
  const [useProxy, setUseProxy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setUrl('')
      setFolderId('')
      setUseProxy(false)
      setError(null)
      setBusy(false)
    }
  }, [open])

  const submit = async (raw?: string): Promise<void> => {
    const target = (raw ?? url).trim()
    if (!target) {
      setError(t('add.url.placeholder'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await addFeed(target, folderId || undefined, useProxy)
      toast(t('add.success', { name: result.feed.title, n: result.count }), 'success')
      setOpen(false)
      navigate(`/feed/${result.feed.id}`)
    } catch (submitError) {
      setError((submitError as Error).message || t('add.fail'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={
        <span className="flex items-center gap-2">
          <Rss size={15} className="text-accent" />
          {t('add.title')}
        </span>
      }
      subtitle={t('add.subtitle')}
      width="sm"
      footer={
        <>
          <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost px-3 py-1.5 text-xs">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="btn btn-primary px-3.5 py-1.5 text-xs disabled:opacity-60"
          >
            {busy ? <Spinner size={12} /> : <Plus size={12} />}
            {busy ? t('add.submitting') : t('add.submit')}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <label className="mb-1.5 block text-[11.5px] font-medium text-muted" htmlFor="feed-url">
          RSS / Atom / 网站地址
        </label>
        <input
          id="feed-url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
            setError(null)
          }}
          placeholder={t('add.url.placeholder')}
          className="field"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />

        <div className="mt-3">
          <label className="mb-1.5 block text-[11.5px] font-medium text-muted" htmlFor="feed-folder">
            {t('add.folder')}
          </label>
          <select
            id="feed-folder"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
            className="field"
          >
            <option value="">{t('add.folder.none')}</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </div>

        {settings.proxy.enabled && settings.proxy.mode === 'selected' && (
          <label className="mt-3 flex items-center gap-2 text-[11.5px] text-muted">
            <input
              type="checkbox"
              checked={useProxy}
              onChange={(event) => setUseProxy(event.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            {t('add.proxy')}
          </label>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-danger/8 px-3 py-2 text-[12px] leading-relaxed text-danger">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-5">
          <p className="mb-2 text-[10.5px] font-medium uppercase tracking-wide text-subtle">{t('add.samples')}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {SAMPLES.map((sample) => (
              <button
                key={sample.url}
                type="button"
                disabled={busy}
                onClick={() => void submit(sample.url)}
                className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-left text-[11.5px] text-muted transition-colors hover:border-accent/40 hover:bg-accent-soft/50 hover:text-fg disabled:opacity-50"
              >
                <span className="truncate">{t(sample.labelKey)}</span>
              </button>
            ))}
          </div>
        </div>

        <p className="mt-4 text-[10.5px] leading-relaxed text-subtle">{t('add.hint')}</p>
      </form>
    </Modal>
  )
}
