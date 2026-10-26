import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  ChevronRight,
  Globe2,
  GripVertical,
  Inbox,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Rss,
  Settings,
  Star,
  X,
} from 'lucide-react'
import { useAppStore } from '../lib/store'
import { useT } from '../lib/useT'
import { isTauriAndroid } from '../lib/platform'
import { cn, formatRelativeTime } from '../lib/utils'
import { unreadByFeed, unreadCount } from '../lib/selectors'
import { BrandMark, FeedIcon } from './FeedIcon'
import { HoverText } from './HoverText'
import { FeedContextMenu } from './FeedContextMenu'
import { Spinner } from './ui'
import type { Feed } from '../types'

interface DragTarget {
  feedId: string
  position: 'before' | 'after'
}

export function Sidebar() {
  const t = useT()
  const location = useLocation()
  // Android has no desktop drag interaction; the grip handle is hidden and
  // rows are not draggable there. Web and Windows keep the full behaviour.
  const reorderEnabled = !isTauriAndroid()
  const feeds = useAppStore((state) => state.feeds)
  const folders = useAppStore((state) => state.folders)
  const articles = useAppStore((state) => state.articles)
  const settings = useAppStore((state) => state.settings)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const refreshing = useAppStore((state) => state.refreshing)
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen)
  const setAddFeedOpen = useAppStore((state) => state.setAddFeedOpen)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const saveSettings = useAppStore((state) => state.saveSettings)
  const refreshAll = useAppStore((state) => state.refreshAll)
  const dropFeed = useAppStore((state) => state.dropFeed)

  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ feedId: string; x: number; y: number } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DragTarget | null>(null)
  const [folderOver, setFolderOver] = useState<string | null>(null)
  const suppressClick = useRef(false)
  const pointerDrag = useRef<{
    id: string
    pointerId: number
    target: DragTarget | null
    folderId: string | null
    link: HTMLAnchorElement | null
  } | null>(null)
  const pointerCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => pointerCleanup.current?.(), [])

  const unread = useMemo(() => unreadCount(articles), [articles])
  const perFeed = useMemo(() => unreadByFeed(articles), [articles])
  const starred = useMemo(() => articles.filter((article) => article.starred).length, [articles])

  const grouped = useMemo(() => {
    const byFolder = new Map<string, Feed[]>()
    const ungrouped: Feed[] = []
    for (const feed of feeds) {
      if (feed.folderId && folders.some((folder) => folder.id === feed.folderId)) {
        const list = byFolder.get(feed.folderId) ?? []
        list.push(feed)
        byFolder.set(feed.folderId, list)
      } else {
        ungrouped.push(feed)
      }
    }
    return { byFolder, ungrouped }
  }, [feeds, folders])

  const lastUpdated = feeds.reduce((latest, feed) => Math.max(latest, feed.lastFetchedAt ?? 0), 0)
  const isFeedActive = (feedId: string): boolean => location.pathname === `/feed/${feedId}`

  const toggleFolder = (folderId: string): void => {
    setCollapsedFolders((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  const close = (): void => setSidebarOpen(false)

  const resetDrag = (): void => {
    setDragId(null)
    setDropTarget(null)
    setFolderOver(null)
  }

  // While dragging a feed, stop the browser from treating the <a> payload as a
  // navigation target anywhere outside our own drop zones.
  useEffect(() => {
    if (!dragId) return
    const preventDefault = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('application/x-flowread-feed')) event.preventDefault()
    }
    window.addEventListener('dragover', preventDefault)
    window.addEventListener('drop', preventDefault)
    return () => {
      window.removeEventListener('dragover', preventDefault)
      window.removeEventListener('drop', preventDefault)
    }
  }, [dragId])

  const handleDragStart = (feedId: string) => (event: React.DragEvent): void => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-flowread-feed', feedId)
    event.dataTransfer.setData('text/plain', feedId)
    suppressClick.current = true
    setDragId(feedId)
  }

  const handleDragEnd = (): void => {
    window.setTimeout(() => {
      suppressClick.current = false
    }, 80)
    resetDrag()
  }

  const handleRowDragOver = (feed: Feed) => (event: React.DragEvent): void => {
    if (!dragId || dragId === feed.id) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget((current) =>
      current?.feedId === feed.id && current.position === position ? current : { feedId: feed.id, position },
    )
  }

  const handleRowDrop = (feed: Feed) => (event: React.DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    if (!dragId || dragId === feed.id) {
      resetDrag()
      return
    }
    const position = dropTarget?.feedId === feed.id ? dropTarget.position : 'before'
    void dropFeed(dragId, {
      ...(position === 'before' ? { beforeFeedId: feed.id } : { afterFeedId: feed.id }),
      folderId: feed.folderId ?? null,
    })
    resetDrag()
  }

  const handleFolderDrop = (folderId: string) => (event: React.DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    if (dragId) void dropFeed(dragId, { folderId })
    resetDrag()
  }

  /**
   * Touch / pen dragging. Native HTML5 drag-and-drop is not available in the
   * Android WebView (and is unreliable for touch), so the grip handle uses
   * pointer events and hit-tests the row/folder under the finger. Listeners are
   * attached to the window so the drag keeps working when the finger leaves
   * the small handle.
   */
  const stopPointerListeners = (): void => {
    pointerCleanup.current?.()
    pointerCleanup.current = null
  }

  const movePointerDrag = (event: PointerEvent): void => {
    const drag = pointerDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const under = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    const row = under?.closest<HTMLElement>('[data-feed-row]')
    const folder = under?.closest<HTMLElement>('[data-folder-row]')
    if (row?.dataset.feedRow && row.dataset.feedRow !== drag.id) {
      const rect = row.getBoundingClientRect()
      const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      drag.target = { feedId: row.dataset.feedRow, position }
      drag.folderId = null
      setDropTarget(drag.target)
      setFolderOver(null)
    } else if (folder?.dataset.folderRow) {
      drag.folderId = folder.dataset.folderRow
      drag.target = null
      setDropTarget(null)
      setFolderOver(drag.folderId)
    } else {
      drag.target = null
      drag.folderId = null
      setDropTarget(null)
      setFolderOver(null)
    }

    const scroller = document.querySelector<HTMLElement>('aside [data-feed-scroll]')
    if (scroller) {
      const rect = scroller.getBoundingClientRect()
      if (event.clientY < rect.top + 44) scroller.scrollTop -= 14
      else if (event.clientY > rect.bottom - 44) scroller.scrollTop += 14
    }
  }

  const finishPointerDrag = (drop: boolean): void => {
    const drag = pointerDrag.current
    if (!drag) return
    pointerDrag.current = null
    stopPointerListeners()
    drag.link?.setAttribute('draggable', 'true')
    if (drop) {
      if (drag.folderId) {
        void dropFeed(drag.id, { folderId: drag.folderId })
      } else if (drag.target) {
        const targetFeed = useAppStore.getState().feeds.find((feed) => feed.id === drag.target?.feedId)
        void dropFeed(drag.id, {
          ...(drag.target.position === 'before'
            ? { beforeFeedId: drag.target.feedId }
            : { afterFeedId: drag.target.feedId }),
          folderId: targetFeed?.folderId ?? null,
        })
      }
    }
    resetDrag()
    window.setTimeout(() => {
      suppressClick.current = false
    }, 250)
  }

  const startPointerDrag =
    (feedId: string) =>
    (event: React.PointerEvent<HTMLSpanElement>): void => {
      // Windows/macOS mouse uses native HTML5 drag; touch platforms (Android)
      // and touch-capable WebViews use the pointer implementation.
      if (event.pointerType === 'mouse' && navigator.maxTouchPoints === 0) return
      event.preventDefault()
      event.stopPropagation()
      stopPointerListeners()
      const link = event.currentTarget.closest<HTMLAnchorElement>('a')
      link?.setAttribute('draggable', 'false')
      pointerDrag.current = {
        id: feedId,
        pointerId: event.pointerId,
        target: null,
        folderId: null,
        link,
      }
      suppressClick.current = true
      setDragId(feedId)
      setDropTarget(null)
      setFolderOver(null)

      const onMove = (native: PointerEvent): void => movePointerDrag(native)
      const onUp = (native: PointerEvent): void => {
        if (pointerDrag.current?.pointerId === native.pointerId) finishPointerDrag(true)
      }
      const onCancel = (native: PointerEvent): void => {
        if (pointerDrag.current?.pointerId === native.pointerId) finishPointerDrag(false)
      }
      window.addEventListener('pointermove', onMove, { passive: false })
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      pointerCleanup.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }
    }

  const openMenu = (feedId: string, event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    openMenuAt(feedId, event.clientX, event.clientY)
  }

  const openMenuAt = (feedId: string, x: number, y: number): void => {
    setMenu({ feedId, x, y })
    setMenuOpen(true)
  }

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          'app-safe-top fixed inset-y-0 left-0 z-50 flex w-[282px] flex-col border-r border-line bg-sidebar transition-transform duration-200 ease-out',
          'lg:static lg:z-auto lg:w-[var(--sidebar-width)] lg:shrink-0 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          settings.sidebarHidden && 'lg:hidden',
        )}
      >
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
          <BrandMark size={28} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold leading-tight tracking-tight">FlowRead</div>
            <div className="text-[10.5px] font-medium tracking-wide text-subtle">{t('app.tagline')}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              setAddFeedOpen(true)
              close()
            }}
            className="icon-button h-7 w-7 border border-line bg-surface"
            aria-label={t('nav.addFeed')}
            title={t('nav.addFeed')}
          >
            <Plus size={15} />
          </button>
          <button
            type="button"
            onClick={() => void saveSettings({ sidebarHidden: true })}
            className="icon-button hidden h-7 w-7 lg:flex"
            aria-label={t('layout.hideSidebar')}
            title={t('layout.hideSidebar')}
          >
            <PanelLeftClose size={15} />
          </button>
          <button
            type="button"
            onClick={close}
            className="icon-button h-7 w-7 lg:hidden"
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>

        <nav className="space-y-0.5 px-2">
          <NavItem
            to="/"
            icon={<Inbox size={16} />}
            label={t('nav.timeline')}
            count={unread}
            active={location.pathname === '/'}
            onNavigate={close}
          />
          <NavItem
            to="/starred"
            icon={<Star size={16} />}
            label={t('nav.starred')}
            count={starred}
            active={location.pathname === '/starred'}
            onNavigate={close}
          />
          <NavItem
            to="/subscriptions"
            icon={<Rss size={16} />}
            label={t('nav.subscriptions')}
            count={feeds.length}
            active={location.pathname === '/subscriptions'}
            onNavigate={close}
          />
        </nav>

        <div className="mt-4 flex items-center justify-between px-4 pb-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">
            {t('sidebar.feeds')}
          </span>
          <button
            type="button"
            onClick={() => {
              setAddFeedOpen(true)
              close()
            }}
            className="text-subtle transition-colors hover:text-fg"
            aria-label={t('nav.addFeed')}
          >
            <Plus size={13} />
          </button>
        </div>
        {/*{feeds.length > 0 && (*/}
        {/*  <p className="hidden px-4 pb-1 text-[10px] leading-relaxed text-subtle/80 lg:block">{t('drag.hint')}</p>*/}
        {/*)}*/}

        <div data-feed-scroll className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {feeds.length === 0 && (
            <p className="px-2 py-3 text-xs leading-relaxed text-subtle">{t('subs.empty.desc')}</p>
          )}

          {folders.map((folder) => {
            const list = grouped.byFolder.get(folder.id) ?? []
            if (list.length === 0) return null
            const collapsed = collapsedFolders.has(folder.id)
            const folderUnread = list.reduce((sum, feed) => sum + (perFeed.get(feed.id) ?? 0), 0)
            const isOver = folderOver === folder.id
            return (
              <div key={folder.id} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggleFolder(folder.id)}
                  onDragOver={(event) => {
                    if (!dragId) return
                    event.preventDefault()
                    event.stopPropagation()
                    setFolderOver(folder.id)
                  }}
                  onDragLeave={() => setFolderOver((current) => (current === folder.id ? null : current))}
                  onDrop={handleFolderDrop(folder.id)}
                  data-folder-row={folder.id}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-medium text-muted transition-colors hover:bg-hover',
                    isOver && 'bg-accent-soft text-accent ring-1 ring-accent/40',
                  )}
                >
                  <ChevronRight
                    size={12}
                    className={cn('transition-transform duration-150', collapsed ? '' : 'rotate-90')}
                  />
                  <HoverText text={folder.name} className="min-w-0 flex-1 truncate text-left" />
                  {folderUnread > 0 && <span className="tabular-nums text-subtle">{folderUnread}</span>}
                </button>
                {!collapsed && (
                  <div className="mt-0.5 space-y-px" onDragLeave={() => setDropTarget(null)}>
                    {list.map((feed) => (
                      <FeedRow
                        key={feed.id}
                        feed={feed}
                        unread={perFeed.get(feed.id) ?? 0}
                        active={isFeedActive(feed.id)}
                        dragging={dragId === feed.id}
                        dropPosition={dropTarget?.feedId === feed.id ? dropTarget.position : null}
                        onNavigate={close}
                        suppressClick={suppressClick}
                        reorderEnabled={reorderEnabled}
                        onContextMenu={openMenu}
                        onMore={openMenuAt}
                        onDragStart={handleDragStart(feed.id)}
                        onDragEnd={handleDragEnd}
                        onDragOver={handleRowDragOver(feed)}
                        onDragLeave={() =>
                          setDropTarget((current) => (current?.feedId === feed.id ? null : current))
                        }
                        onDrop={handleRowDrop(feed)}
                        onPointerDragStart={startPointerDrag(feed.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {grouped.ungrouped.length > 0 && (
            <div className={cn('space-y-px', folders.length > 0 && 'mt-1 border-t border-line pt-2')}>
              {grouped.ungrouped.map((feed) => (
                <FeedRow
                  key={feed.id}
                  feed={feed}
                  unread={perFeed.get(feed.id) ?? 0}
                  active={isFeedActive(feed.id)}
                  dragging={dragId === feed.id}
                  dropPosition={dropTarget?.feedId === feed.id ? dropTarget.position : null}
                  onNavigate={close}
                  suppressClick={suppressClick}
                  reorderEnabled={reorderEnabled}
                  onContextMenu={openMenu}
                  onMore={openMenuAt}
                  onDragStart={handleDragStart(feed.id)}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleRowDragOver(feed)}
                  onDragLeave={() => setDropTarget((current) => (current?.feedId === feed.id ? null : current))}
                  onDrop={handleRowDrop(feed)}
                  onPointerDragStart={startPointerDrag(feed.id)}
                />
              ))}
            </div>
          )}
        </div>

        <footer className="border-t border-line p-2">
          {refreshing.running ? (
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-2 text-[11.5px] text-muted">
                <Spinner size={12} className="text-accent" />
                <span className="tabular-nums">
                  {t('refresh.progress', { done: refreshing.done, total: refreshing.total })}
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${refreshing.total ? (refreshing.done / refreshing.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void refreshAll()}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11.5px] text-subtle transition-colors hover:bg-hover hover:text-fg"
              disabled={feeds.length === 0}
            >
              <RefreshCw size={12} />
              <span>
                {lastUpdated
                  ? t('subs.feed.updated', { time: formatRelativeTime(lastUpdated, settings.locale) })
                  : t('subs.feed.never')}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(true)
              close()
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] font-medium text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <Settings size={14} />
            {t('nav.settings')}
          </button>
        </footer>
      </aside>

      {menu && (
        <FeedContextMenu
          feedId={menu.feedId}
          x={menu.x}
          y={menu.y}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </>
  )
}

function NavItem({
  to,
  icon,
  label,
  count,
  active,
  onNavigate,
}: {
  to: string
  icon: React.ReactNode
  label: string
  count?: number
  active: boolean
  onNavigate: () => void
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors',
        active ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.05)]' : 'text-muted hover:bg-hover hover:text-fg',
      )}
    >
      <span className={cn('shrink-0', active ? 'text-accent' : 'text-subtle')}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && count > 0 && (
        <span className="shrink-0 rounded-full bg-hover px-1.5 py-px text-[10.5px] font-semibold tabular-nums text-subtle">
          {count > 999 ? '999+' : count}
        </span>
      )}
    </Link>
  )
}

interface FeedRowProps {
  feed: Feed
  unread: number
  active: boolean
  dragging: boolean
  dropPosition: 'before' | 'after' | null
  onNavigate: () => void
  suppressClick: React.RefObject<boolean>
  reorderEnabled: boolean
  onContextMenu: (feedId: string, event: React.MouseEvent) => void
  onMore: (feedId: string, x: number, y: number) => void
  onDragStart: (event: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (event: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (event: React.DragEvent) => void
  onPointerDragStart: (event: React.PointerEvent<HTMLSpanElement>) => void
}

function FeedRow({
  feed,
  unread,
  active,
  dragging,
  dropPosition,
  onNavigate,
  suppressClick,
  reorderEnabled,
  onContextMenu,
  onMore,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onPointerDragStart,
}: FeedRowProps) {
  const t = useT()
  return (
    <div
      data-feed-row={feed.id}
      className={cn(
        'group/feed relative',
        dropPosition === 'before' &&
          'before:absolute before:inset-x-2 before:-top-px before:z-10 before:h-[2px] before:rounded-full before:bg-accent',
        dropPosition === 'after' &&
          'after:absolute after:inset-x-2 after:-bottom-px after:z-10 after:h-[2px] after:rounded-full after:bg-accent',
      )}
      onContextMenu={(event) => onContextMenu(feed.id, event)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Link
        to={`/feed/${feed.id}`}
        onClick={(event) => {
          if (suppressClick.current) {
            event.preventDefault()
            return
          }
          onNavigate()
        }}
        draggable={reorderEnabled}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={cn(
          'relative flex items-center gap-2 rounded-lg py-[6px] pl-3 pr-7 text-[12.5px] transition-colors',
          reorderEnabled && 'cursor-grab active:cursor-grabbing',
          active ? 'bg-active font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg',
          dragging && 'opacity-40',
        )}
      >
        <FeedIcon feed={feed} size={16} />
        {reorderEnabled && (
          <span
          role="button"
          aria-label={t('drag.handle')}
          title={t('drag.handle')}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDown={onPointerDragStart}
          className="flex h-6 w-5 shrink-0 touch-none items-center justify-center rounded text-subtle opacity-100 transition-opacity lg:opacity-0 lg:group-hover/feed:opacity-100"
        >
          <GripVertical size={12} />
        </span>
        )}
        <HoverText text={feed.title} className="min-w-0 flex-1 truncate" />
        {feed.useProxy && <Globe2 size={10} className="shrink-0 text-accent" aria-label={t('menu.proxy')} />}
        {feed.lastError && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger/70" title={feed.lastError} />
        )}
        {unread > 0 && (
          <span className={cn('shrink-0 text-[10.5px] tabular-nums', active ? 'text-fg' : 'text-subtle')}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
      <button
        type="button"
        aria-label={t('reader.more')}
        title={t('reader.more')}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          onMore(feed.id, rect.left, rect.bottom + 4)
        }}
        className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-subtle opacity-100 transition-opacity hover:bg-hover hover:text-fg lg:opacity-0 lg:group-hover/feed:opacity-100"
      >
        <MoreHorizontal size={13} />
      </button>
    </div>
  )
}
