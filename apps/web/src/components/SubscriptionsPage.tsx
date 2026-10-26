import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  Check,
  FolderInput,
  FolderPlus,
  Menu,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
  Rss,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { Feed } from '../types'
import { useAppStore } from '../lib/store'
import { useT } from '../lib/useT'
import { cn, formatRelativeTime } from '../lib/utils'
import { articleCountByFeed, unreadByFeed } from '../lib/selectors'
import { FeedIcon } from './FeedIcon'
import { FeedContextMenu } from './FeedContextMenu'
import { ConfirmDialog } from './ConfirmDialog'
import { OpmlImportButton } from './OpmlImportButton'
import { EmptyState, Spinner } from './ui'

export function SubscriptionsPage() {
  const t = useT()
  const locale = useAppStore((state) => state.settings.locale)
  const feeds = useAppStore((state) => state.feeds)
  const folders = useAppStore((state) => state.folders)
  const articles = useAppStore((state) => state.articles)
  const refreshing = useAppStore((state) => state.refreshing)
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen)
  const sidebarHidden = useAppStore((state) => state.settings.sidebarHidden)
  const saveSettings = useAppStore((state) => state.saveSettings)
  const setAddFeedOpen = useAppStore((state) => state.setAddFeedOpen)
  const refreshAll = useAppStore((state) => state.refreshAll)
  const refreshFeed = useAppStore((state) => state.refreshFeed)
  const removeFeed = useAppStore((state) => state.removeFeed)
  const moveFeed = useAppStore((state) => state.moveFeed)
  const createFolder = useAppStore((state) => state.createFolder)
  const renameFolder = useAppStore((state) => state.renameFolder)
  const deleteFolder = useAppStore((state) => state.deleteFolder)
  const exportOpml = useAppStore((state) => state.exportOpml)
  const toast = useAppStore((state) => state.toast)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moveOpen, setMoveOpen] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)
  const [newFolder, setNewFolder] = useState('')
  const [editingFolder, setEditingFolder] = useState<{ id: string; name: string } | null>(null)
  const [refreshingFeed, setRefreshingFeed] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ feedId: string; x: number; y: number } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirm, setConfirm] = useState<{
    title: string
    message: string
    confirmLabel: string
    onConfirm: () => void | Promise<void>
  } | null>(null)

  const unread = useMemo(() => unreadByFeed(articles), [articles])
  const counts = useMemo(() => articleCountByFeed(articles), [articles])

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase()
    if (!search) return feeds
    return feeds.filter(
      (feed) => feed.title.toLowerCase().includes(search) || feed.url.toLowerCase().includes(search),
    )
  }, [feeds, query])

  const grouped = useMemo(() => {
    const map = new Map<string, Feed[]>()
    const ungrouped: Feed[] = []
    for (const feed of filtered) {
      if (feed.folderId && folders.some((folder) => folder.id === feed.folderId)) {
        const list = map.get(feed.folderId) ?? []
        list.push(feed)
        map.set(feed.folderId, list)
      } else {
        ungrouped.push(feed)
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.title.localeCompare(b.title))
    ungrouped.sort((a, b) => a.title.localeCompare(b.title))
    return { map, ungrouped }
  }, [filtered, folders])

  const allSelected = filtered.length > 0 && filtered.every((feed) => selected.has(feed.id))
  const someSelected = filtered.some((feed) => selected.has(feed.id))

  useEffect(() => {
    setSelected((current) => {
      const ids = new Set(feeds.map((feed) => feed.id))
      const next = new Set([...current].filter((id) => ids.has(id)))
      return next.size === current.size ? current : next
    })
  }, [feeds])

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected
  }, [someSelected, allSelected])

  const toggleSelected = (feedId: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(feedId)) next.delete(feedId)
      else next.add(feedId)
      return next
    })
  }

  const toggleAll = (): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (allSelected) filtered.forEach((feed) => next.delete(feed.id))
      else filtered.forEach((feed) => next.add(feed.id))
      return next
    })
  }

  const bulkMove = async (folderId?: string): Promise<void> => {
    const ids = [...selected]
    if (ids.length === 0) return
    await Promise.all(ids.map((id) => moveFeed(id, folderId)))
    setSelected(new Set())
    setMoveOpen(false)
    toast(t('subs.bulk.moved', { n: ids.length }), 'success')
  }

  const bulkDelete = async (ids: string[]): Promise<void> => {
    await Promise.all(ids.map((id) => removeFeed(id, { silent: true })))
    setSelected(new Set())
    toast(t('subs.bulk.removed', { n: ids.length }), 'success')
  }

  const requestBulkDelete = (): void => {
    const ids = [...selected]
    if (ids.length === 0) return
    setConfirm({
      title: t('subs.bulk.unsubscribe'),
      message: t('subs.bulk.deleteConfirm', { n: ids.length }),
      confirmLabel: t('subs.bulk.unsubscribe'),
      onConfirm: () => bulkDelete(ids),
    })
  }

  const submitFolder = async (): Promise<void> => {
    const name = newFolder.trim()
    if (!name) return
    await createFolder(name)
    setNewFolder('')
    setCreating(false)
  }

  const onRefresh = async (feed: Feed): Promise<void> => {
    setRefreshingFeed(feed.id)
    try {
      await refreshFeed(feed.id)
    } finally {
      setRefreshingFeed(null)
    }
  }

  const renderFeed = (feed: Feed) => {
    const isSelected = selected.has(feed.id)
    return (
      <div
        key={feed.id}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a, button, select, input, label')) return
          toggleSelected(feed.id)
        }}
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest('select, button, a')) return
          event.preventDefault()
          setMenu({ feedId: feed.id, x: event.clientX, y: event.clientY })
          setMenuOpen(true)
        }}
        className={cn(
          'group flex flex-wrap items-center gap-2.5 rounded-xl border bg-surface px-3 py-2.5 transition-colors sm:flex-nowrap sm:gap-3',
          isSelected
            ? 'border-accent/45 bg-accent-soft/40'
            : 'border-line hover:border-line-strong',
        )}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => toggleSelected(feed.id)}
          onClick={(event) => event.stopPropagation()}
          className="h-4 w-4 shrink-0 cursor-pointer accent-accent"
          aria-label={t('subs.selectFeed', { name: feed.title })}
        />
        <FeedIcon feed={feed} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            to={`/feed/${feed.id}`}
            className="truncate text-[13px] font-medium text-fg transition-colors hover:text-accent"
          >
            {feed.title}
          </Link>
          {feed.lastError && (
            <span title={t('subs.feed.error', { msg: feed.lastError })} className="shrink-0 text-danger">
              <AlertCircle size={12} />
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-subtle">
          <span className="max-w-[240px] truncate">{feed.siteUrl ?? feed.url}</span>
          <span>·</span>
          <span>{t('subs.feed.count', { n: counts.get(feed.id) ?? 0 })}</span>
          {(unread.get(feed.id) ?? 0) > 0 && (
            <span className="text-accent">{t('subs.feed.unread', { n: unread.get(feed.id) ?? 0 })}</span>
          )}
          <span>·</span>
          <span>
            {feed.lastFetchedAt
              ? t('subs.feed.updated', { time: formatRelativeTime(feed.lastFetchedAt, locale) })
              : t('subs.feed.never')}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void onRefresh(feed)}
          disabled={refreshingFeed === feed.id}
          className="icon-button h-7 w-7"
          title={t('list.refresh')}
          aria-label={t('list.refresh')}
        >
          {refreshingFeed === feed.id ? <Spinner size={12} /> : <RefreshCw size={12} />}
        </button>
        <select
          value={feed.folderId ?? ''}
          onChange={(event) => void moveFeed(feed.id, event.target.value || undefined)}
          className="max-w-[104px] rounded-md border border-line bg-bg px-1.5 py-1 text-[10.5px] text-muted"
          title={t('subs.feed.move')}
          aria-label={t('subs.feed.move')}
        >
          <option value="">{t('subs.folder.default')}</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
          <button
            type="button"
            onClick={() => {
              setConfirm({
                title: t('subs.feed.delete'),
                message: t('subs.feed.deleteConfirm', { name: feed.title }),
                confirmLabel: t('subs.feed.delete'),
                onConfirm: () => removeFeed(feed.id),
              })
            }}
            className="icon-button h-7 w-7 hover:text-danger"
            title={t('subs.feed.delete')}
            aria-label={t('subs.feed.delete')}
          >
          <Trash2 size={12} />
        </button>
      </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <header className="app-safe-top glass-panel z-20 shrink-0 border-b border-line">
        <div className="mx-auto w-full max-w-[900px] px-3 py-2.5 lg:px-6">
          <div className="flex items-center gap-2">
            {sidebarHidden && (
              <button
                type="button"
                onClick={() => void saveSettings({ sidebarHidden: false })}
                className="icon-button hidden h-8 w-8 lg:flex"
                aria-label={t('layout.showSidebar')}
                title={t('layout.showSidebar')}
              >
                <PanelLeftOpen size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="icon-button h-8 w-8 lg:hidden"
              aria-label="打开侧栏"
            >
              <Menu size={17} />
            </button>
            <Rss size={16} className="hidden text-accent sm:block" />
            <h1 className="text-[15px] font-semibold tracking-tight">{t('subs.title')}</h1>
            <span className="rounded-full bg-hover px-1.5 py-px text-[10.5px] tabular-nums text-subtle">
              {feeds.length}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <OpmlImportButton className="hidden !px-2.5 !py-1.5 !text-[11px] sm:inline-flex" />
              <button
                type="button"
                onClick={() => setAddFeedOpen(true)}
                className="btn btn-primary px-2.5 py-1.5 text-[11.5px]"
              >
                {t('subs.add')}
              </button>
              <button
                type="button"
                onClick={exportOpml}
                disabled={feeds.length === 0}
                className="icon-button h-8 w-8 disabled:opacity-40"
                title={t('subs.export')}
                aria-label={t('subs.export')}
              >
                <Upload size={14} />
              </button>
              <button
                type="button"
                onClick={() => void refreshAll()}
                disabled={refreshing.running || feeds.length === 0}
                className="icon-button h-8 w-8 disabled:opacity-40"
                title={t('subs.refresh')}
                aria-label={t('subs.refresh')}
              >
                {refreshing.running ? <Spinner size={13} /> : <RefreshCw size={14} />}
              </button>
            </div>
          </div>
          <p className="mt-1 hidden text-[11px] text-subtle sm:block">{t('subs.subtitle')}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-3 py-4 pb-28 lg:px-6 lg:pb-10">
          {feeds.length === 0 ? (
            <EmptyState
              icon={<Rss size={20} />}
              title={t('subs.empty.title')}
              description={t('subs.empty.desc')}
              action={
                <>
                  <OpmlImportButton variant="primary" />
                  <button
                    type="button"
                    onClick={() => setAddFeedOpen(true)}
                    className="btn btn-outline px-3 py-1.5 text-xs"
                  >
                    {t('subs.add')}
                  </button>
                </>
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('subs.search')}
                    className="field py-1.5 pl-8 text-[12.5px]"
                  />
                </div>
                {creating ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={newFolder}
                      onChange={(event) => setNewFolder(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void submitFolder()
                        if (event.key === 'Escape') {
                          setCreating(false)
                          setNewFolder('')
                        }
                      }}
                      placeholder={t('subs.folder.name')}
                      className="field w-[150px] py-1.5 text-[12px]"
                    />
                    <button type="button" onClick={() => void submitFolder()} className="icon-button h-7 w-7 text-accent">
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreating(false)
                        setNewFolder('')
                      }}
                      className="icon-button h-7 w-7"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="btn btn-outline px-2.5 py-1.5 text-[11.5px]"
                  >
                    <FolderPlus size={12} />
                    {t('subs.folder.new')}
                  </button>
                )}
              </div>

              <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
                <input
                  ref={selectAllRef}
                  id="select-all-feeds"
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={filtered.length === 0}
                  className="h-4 w-4 cursor-pointer accent-accent disabled:opacity-40"
                  aria-label={t('subs.selectAll')}
                />
                <label
                  htmlFor="select-all-feeds"
                  className="cursor-pointer text-[11.5px] font-medium text-muted"
                >
                  {t('subs.selectAll')}
                </label>
                <span className="ml-auto text-[10.5px] tabular-nums text-subtle">{filtered.length}</span>
              </div>

              {folders.map((folder) => {
                const list = grouped.map.get(folder.id) ?? []
                if (list.length === 0) return null
                return (
                  <section key={folder.id} className="mt-5">
                    <div className="mb-2 flex items-center gap-2">
                      {editingFolder?.id === folder.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            value={editingFolder.name}
                            onChange={(event) => setEditingFolder({ id: folder.id, name: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                void renameFolder(folder.id, editingFolder.name)
                                setEditingFolder(null)
                              }
                              if (event.key === 'Escape') setEditingFolder(null)
                            }}
                            className="field w-[160px] py-1 text-[12px]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              void renameFolder(folder.id, editingFolder.name)
                              setEditingFolder(null)
                            }}
                            className="icon-button h-6 w-6 text-accent"
                          >
                            <Check size={12} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
                            {folder.name}
                          </h2>
                          <span className="text-[10.5px] text-subtle">{t('subs.folderCount', { n: list.length })}</span>
                          <div className="ml-auto flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => setEditingFolder({ id: folder.id, name: folder.name })}
                              className="icon-button h-6 w-6"
                              title={t('subs.folder.rename')}
                              aria-label={t('subs.folder.rename')}
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirm({
                                  title: t('subs.folder.delete'),
                                  message: t('subs.folder.deleteConfirm', { name: folder.name }),
                                  confirmLabel: t('common.delete'),
                                  onConfirm: () => deleteFolder(folder.id),
                                })
                              }}
                              className="icon-button h-6 w-6 hover:text-danger"
                              title={t('subs.folder.delete')}
                              aria-label={t('subs.folder.delete')}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="space-y-1.5">{list.map(renderFeed)}</div>
                  </section>
                )
              })}

              {grouped.ungrouped.length > 0 && (
                <section className="mt-5">
                  <div className="mb-2 flex items-center gap-2">
                    <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
                      {t('subs.folder.default')}
                    </h2>
                    <span className="text-[10.5px] text-subtle">
                      {t('subs.folderCount', { n: grouped.ungrouped.length })}
                    </span>
                  </div>
                  <div className="space-y-1.5">{grouped.ungrouped.map(renderFeed)}</div>
                </section>
              )}

              {filtered.length === 0 && (
                <p className={cn('py-12 text-center text-[12.5px] text-subtle')}>{t('list.noResult.title')}</p>
              )}
            </>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="fixed bottom-20 left-1/2 z-40 flex max-w-[calc(100vw-20px)] -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-elevated/95 px-2.5 py-2 shadow-2xl backdrop-blur lg:bottom-6">
          <span className="whitespace-nowrap px-1 text-[11.5px] font-medium">
            {t('subs.selectedCount', { n: selected.size })}
          </span>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-full px-2 py-1 text-[11px] text-subtle transition-colors hover:bg-hover hover:text-fg"
          >
            {t('subs.clearSelection')}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMoveOpen((value) => !value)}
              className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <FolderInput size={12} />
              {t('subs.bulk.move')}
            </button>
            {moveOpen && (
              <div className="absolute bottom-full left-1/2 z-50 mb-2 w-44 -translate-x-1/2 rounded-xl border border-line bg-elevated p-1 shadow-2xl">
                <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-subtle">
                  {t('subs.bulk.moveTo')}
                </p>
                <button
                  type="button"
                  onClick={() => void bulkMove(undefined)}
                  className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[11.5px] text-muted hover:bg-hover hover:text-fg"
                >
                  {t('subs.folder.default')}
                </button>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => void bulkMove(folder.id)}
                    className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[11.5px] text-muted hover:bg-hover hover:text-fg"
                  >
                    {folder.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={requestBulkDelete}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-danger transition-colors hover:bg-danger/10"
          >
            <Trash2 size={12} />
            {t('subs.bulk.unsubscribe')}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.confirmLabel}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm
          setConfirm(null)
          if (action) void action.onConfirm()
        }}
      />

      {menu && (
        <FeedContextMenu
          feedId={menu.feedId}
          x={menu.x}
          y={menu.y}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  )
}
