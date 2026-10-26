import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCheck, Copy, ExternalLink, Globe2, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useAppStore } from '../lib/store'
import { useT } from '../lib/useT'
import { copyText } from '../lib/utils'
import { normalizeProxyUrl } from '../lib/proxy'
import { ContextMenu, type ContextMenuSection } from './ContextMenu'
import { ConfirmDialog } from './ConfirmDialog'
import { FeedIcon } from './FeedIcon'
import { Modal, Spinner } from './ui'

interface FeedContextMenuProps {
  feedId: string
  x: number
  y: number
  open: boolean
  onClose: () => void
}

/** Right-click actions for a subscription, shared by the sidebar and the feeds page. */
export function FeedContextMenu({ feedId, x, y, open, onClose }: FeedContextMenuProps) {
  const t = useT()
  const navigate = useNavigate()
  const feed = useAppStore((state) => state.feeds.find((candidate) => candidate.id === feedId))
  const folders = useAppStore((state) => state.folders)
  const settings = useAppStore((state) => state.settings)
  const refreshFeed = useAppStore((state) => state.refreshFeed)
  const setFeedProxy = useAppStore((state) => state.setFeedProxy)
  const editFeed = useAppStore((state) => state.editFeed)
  const markAllRead = useAppStore((state) => state.markAllRead)
  const moveFeed = useAppStore((state) => state.moveFeed)
  const removeFeed = useAppStore((state) => state.removeFeed)
  const toast = useAppStore((state) => state.toast)
  const [editOpen, setEditOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftUrl, setDraftUrl] = useState('')
  const [draftFolder, setDraftFolder] = useState('')
  const [draftProxy, setDraftProxy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    if (!feed) onClose()
  }, [feed, onClose])

  if (!feed) return null

  const openEdit = (): void => {
    setDraftTitle(feed.title)
    setDraftUrl(feed.url)
    setDraftFolder(feed.folderId ?? '')
    setDraftProxy(Boolean(feed.useProxy))
    setEditError(null)
    setEditOpen(true)
  }

  const saveEdit = async (): Promise<void> => {
    setSaving(true)
    setEditError(null)
    try {
      await editFeed(feed.id, {
        title: draftTitle,
        url: draftUrl,
        folderId: draftFolder || null,
        useProxy: draftProxy,
      })
      setEditOpen(false)
    } catch (error) {
      setEditError((error as Error).message || t('edit.fetchFailed'))
    } finally {
      setSaving(false)
    }
  }

  const sections: ContextMenuSection[] = [
    {
      items: [
        {
          id: 'open',
          label: t('menu.open'),
          icon: <ExternalLink size={13} />,
          onSelect: () => navigate(`/feed/${feed.id}`),
        },
        {
          id: 'refresh',
          label: t('menu.refresh'),
          icon: <RefreshCw size={13} />,
          onSelect: () => void refreshFeed(feed.id),
        },
        {
          id: 'read',
          label: t('menu.markAllRead'),
          icon: <CheckCheck size={13} />,
          onSelect: () => void markAllRead(feed.id),
        },
      ],
    },
    {
      label: t('menu.moveTo'),
      items: [
        {
          id: 'folder-none',
          label: t('subs.folder.default'),
          checked: !feed.folderId,
          onSelect: () => void moveFeed(feed.id, undefined),
        },
        ...folders.map((folder) => ({
          id: `folder-${folder.id}`,
          label: folder.name,
          checked: feed.folderId === folder.id,
          onSelect: () => void moveFeed(feed.id, folder.id),
        })),
      ],
    },
    ...(settings.proxy.enabled &&
    settings.proxy.mode === 'selected' &&
    normalizeProxyUrl(settings.proxy.url)
      ? [
          {
            label: t('settings.section.proxy'),
            items: [
              {
                id: 'proxy',
                label: t('menu.proxy'),
                icon: <Globe2 size={13} />,
                checked: Boolean(feed.useProxy),
                onSelect: () => void setFeedProxy(feed.id, !feed.useProxy),
              },
            ],
          },
        ]
      : []),
    {
      items: [
        {
          id: 'edit',
          label: t('menu.edit'),
          icon: <Pencil size={13} />,
          onSelect: openEdit,
        },
        {
          id: 'copy',
          label: t('menu.copyUrl'),
          icon: <Copy size={13} />,
          onSelect: () => {
            void copyText(feed.url).then((ok) => {
              if (ok) toast(t('toast.copied'), 'success')
            })
          },
        },
        {
          id: 'delete',
          label: t('menu.delete'),
          icon: <Trash2 size={13} />,
          danger: true,
          onSelect: () => setDeleteOpen(true),
        },
      ],
    },
  ]

  return (
    <>
      <ContextMenu open={open} x={x} y={y} sections={sections} onClose={onClose} />
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={t('edit.title')}
        subtitle={t('edit.subtitle')}
        width="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="btn btn-ghost px-3 py-1.5 text-xs"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={saving || !draftTitle.trim() || !draftUrl.trim()}
              className="btn btn-primary px-3.5 py-1.5 text-xs disabled:opacity-50"
            >
              {saving ? <Spinner size={12} /> : null}
              {saving ? t('edit.saving') : t('common.save')}
            </button>
          </>
        }
      >
        <div className="flex items-center gap-3 pb-4">
          <FeedIcon feed={feed} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{feed.title}</p>
            <p className="truncate text-[11px] text-subtle">{feed.url}</p>
          </div>
        </div>

        <label className="mb-1.5 block text-[11.5px] font-medium text-muted" htmlFor="feed-edit-title">
          {t('edit.name')}
        </label>
        <input
          id="feed-edit-title"
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          className="field mb-3"
          autoComplete="off"
        />

        <label className="mb-1.5 block text-[11.5px] font-medium text-muted" htmlFor="feed-edit-url">
          {t('edit.url')}
        </label>
        <input
          id="feed-edit-url"
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.target.value)}
          className="field font-mono text-[12px]"
          spellCheck={false}
          autoComplete="off"
        />
        <p className="mt-1 text-[10.5px] leading-relaxed text-subtle">{t('edit.urlHint')}</p>

        <label className="mb-1.5 mt-3 block text-[11.5px] font-medium text-muted" htmlFor="feed-edit-folder">
          {t('add.folder')}
        </label>
        <select
          id="feed-edit-folder"
          value={draftFolder}
          onChange={(event) => setDraftFolder(event.target.value)}
          className="field"
        >
          <option value="">{t('add.folder.none')}</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>

        {settings.proxy.enabled && settings.proxy.mode === 'selected' && (
          <label className="mt-3 flex items-center gap-2 text-[11.5px] text-muted">
            <input
              type="checkbox"
              checked={draftProxy}
              onChange={(event) => setDraftProxy(event.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            {t('add.proxy')}
          </label>
        )}

        {editError && (
          <div className="mt-3 rounded-lg bg-danger/8 px-3 py-2 text-[11.5px] leading-relaxed text-danger">
            {editError}
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={deleteOpen}
        title={t('subs.feed.delete')}
        message={t('subs.feed.deleteConfirm', { name: feed.title })}
        confirmLabel={t('subs.feed.delete')}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false)
          void removeFeed(feed.id)
        }}
      />
    </>
  )
}
