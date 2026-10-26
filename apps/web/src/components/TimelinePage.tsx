import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useLocation } from 'react-router-dom'
import {
  CheckCheck,
  List,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Rss,
  Search,
  Star,
  X,
} from 'lucide-react'
import { useAppStore } from '../lib/store'
import { useT } from '../lib/useT'
import { cn } from '../lib/utils'
import { filterArticles, unreadCount } from '../lib/selectors'
import { ArticleList } from './ArticleList'
import { Reader } from './Reader'
import { Welcome } from './Welcome'
import { Spinner } from './ui'
import { FeedIcon } from './FeedIcon'

const PAGE_SIZE = 80

export function TimelinePage() {
  const t = useT()
  const { feedId } = useParams()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('a')

  const feeds = useAppStore((state) => state.feeds)
  const articles = useAppStore((state) => state.articles)
  const settings = useAppStore((state) => state.settings)
  const query = useAppStore((state) => state.query)
  const setQuery = useAppStore((state) => state.setQuery)
  const refreshing = useAppStore((state) => state.refreshing)
  const refreshAll = useAppStore((state) => state.refreshAll)
  const markAllRead = useAppStore((state) => state.markAllRead)
  const toggleStar = useAppStore((state) => state.toggleStar)
  const markRead = useAppStore((state) => state.markRead)
  const saveSettings = useAppStore((state) => state.saveSettings)
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen)
  const setAddFeedOpen = useAppStore((state) => state.setAddFeedOpen)

  const [searchOpen, setSearchOpen] = useState(false)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const isStarred = location.pathname === '/starred'
  const feed = useMemo(() => feeds.find((candidate) => candidate.id === feedId), [feeds, feedId])

  const filtered = useMemo(
    () =>
      filterArticles(articles, {
        ...(feedId ? { feedId } : {}),
        ...(isStarred ? { starred: true } : {}),
        query,
        unreadOnly: settings.unreadOnly,
        feeds,
      }),
    [articles, feedId, isStarred, query, settings.unreadOnly, feeds],
  )

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit])
  const selected = useMemo(
    () => articles.find((article) => article.id === selectedId) ?? null,
    [articles, selectedId],
  )
  const selectedFeed = useMemo(
    () => (selected ? feeds.find((candidate) => candidate.id === selected.feedId) : undefined),
    [feeds, selected],
  )
  const hideList = Boolean(selected) && settings.listHidden
  const unread = useMemo(
    () => unreadCount(articles, feedId),
    [articles, feedId],
  )
  const title = isStarred ? t('nav.starred') : feed ? feed.title : t('nav.timeline')

  useEffect(() => {
    if (!selectedId) return
    const article = articles.find((candidate) => candidate.id === selectedId)
    if (article && settings.markReadOnOpen && !article.read) {
      void markRead(article.id, true)
    }
    // Mark read once when an article is opened via deep link / hover actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, settings.markReadOnOpen, markRead])

  useEffect(() => {
    setLimit(PAGE_SIZE)
    listRef.current?.scrollTo({ top: 0 })
  }, [feedId, isStarred, query, settings.unreadOnly])

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  const select = (articleId: string): void => {
    const next = new URLSearchParams(searchParams)
    next.set('a', articleId)
    setSearchParams(next)
    const article = articles.find((candidate) => candidate.id === articleId)
    if (article && settings.markReadOnOpen && !article.read) void markRead(article.id, true)
  }

  const clearSelection = (): void => {
    const next = new URLSearchParams(searchParams)
    next.delete('a')
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault()
        if (filtered.length === 0) return
        const index = filtered.findIndex((article) => article.id === selectedId)
        const nextIndex = event.key === 'j' ? Math.min(filtered.length - 1, index + 1) : Math.max(0, index - 1)
        const nextArticle = filtered[nextIndex]
        if (nextArticle) select(nextArticle.id)
      } else if (event.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false)
          setQuery('')
        } else if (selectedId) {
          clearSelection()
        }
      } else if (event.key === '/' && !searchOpen) {
        event.preventDefault()
        setSearchOpen(true)
      } else if (selectedId) {
        if (event.key === 's') {
          event.preventDefault()
          void toggleStar(selectedId)
        } else if (event.key === 'm') {
          event.preventDefault()
          const article = articles.find((candidate) => candidate.id === selectedId)
          if (article) void markRead(article.id, !article.read)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const onListScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const element = event.currentTarget
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 400) {
      if (limit < filtered.length) setLimit((current) => current + PAGE_SIZE)
    }
  }

  if (!feed && feedId) {
    return (
      <div className="flex flex-1 items-center justify-center px-8 text-center">
        <div>
          <p className="text-sm font-medium">订阅源不存在</p>
          <p className="mt-1 text-xs text-muted">它可能已经被删除。</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1">
        <section
          className={cn(
            'flex min-h-0 min-w-0 flex-col bg-bg',
            'w-full lg:w-[var(--list-width)] lg:shrink-0 lg:border-r lg:border-line',
            selected && 'hidden lg:flex',
            hideList && 'lg:hidden',
          )}
        >
          <header className="app-safe-top glass-panel z-20 shrink-0 border-b border-line">
            <div className="flex h-[52px] items-center gap-1.5 px-2 lg:px-3">
              {settings.sidebarHidden && (
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
              {feed && <FeedIcon feed={feed} size={17} />}
              <h1 className="min-w-0 truncate text-[14.5px] font-semibold tracking-tight">{title}</h1>
              {unread > 0 && (
                <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-px text-[10.5px] font-semibold tabular-nums text-accent">
                  {unread}
                </span>
              )}
              <div className="ml-auto flex items-center gap-0.5">
                {selected && !settings.listHidden && (
                  <button
                    type="button"
                    onClick={() => void saveSettings({ listHidden: true })}
                    className="icon-button hidden h-8 w-8 lg:flex"
                    aria-label={t('layout.hideList')}
                    title={t('layout.hideList')}
                  >
                    <PanelLeftClose size={15} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen((value) => !value)
                    if (searchOpen) setQuery('')
                  }}
                  className="icon-button h-8 w-8"
                  data-active={searchOpen || Boolean(query)}
                  aria-label="搜索"
                >
                  <Search size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => void refreshAll()}
                  className="icon-button h-8 w-8"
                  disabled={refreshing.running}
                  aria-label={t('list.refresh')}
                  title={t('list.refresh')}
                >
                  {refreshing.running ? <Spinner size={14} /> : <RefreshCw size={15} />}
                </button>
                <button
                  type="button"
                  onClick={() => void markAllRead(feedId)}
                  className="icon-button h-8 w-8"
                  aria-label={t('list.markAllRead')}
                  title={t('list.markAllRead')}
                  disabled={unread === 0}
                >
                  <CheckCheck size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => void saveSettings({ view: settings.view === 'card' ? 'compact' : 'card' })}
                  className="icon-button hidden h-8 w-8 sm:flex"
                  aria-label={settings.view === 'card' ? t('list.viewCompact') : t('list.viewCard')}
                  title={settings.view === 'card' ? t('list.viewCompact') : t('list.viewCard')}
                >
                  <List size={15} />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 px-2 pb-2 lg:px-3">
              <div className="inline-flex items-center gap-0.5 rounded-lg bg-hover p-0.5">
                {[
                  { value: false, label: t('list.filter.all') },
                  { value: true, label: t('list.filter.unread') },
                ].map((option) => (
                  <button
                    key={String(option.value)}
                    type="button"
                    onClick={() => void saveSettings({ unreadOnly: option.value })}
                    className={cn(
                      'rounded-[7px] px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                      settings.unreadOnly === option.value
                        ? 'bg-surface text-fg shadow-sm ring-1 ring-line'
                        : 'text-muted hover:text-fg',
                    )}
                    aria-pressed={settings.unreadOnly === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <span className="text-[10.5px] tabular-nums text-subtle">{filtered.length}</span>
              {isStarred && (
                <span className="ml-auto flex items-center gap-1 text-[10.5px] text-subtle">
                  <Star size={10} /> {filtered.length}
                </span>
              )}
            </div>

            {searchOpen && (
              <div className="px-2 pb-2.5 lg:px-3">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('list.search.placeholder')}
                    className="field py-1.5 pl-8 pr-8 text-[12.5px]"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-subtle hover:text-fg"
                      aria-label="清除搜索"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </header>

          <div ref={listRef} onScroll={onListScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {feeds.length === 0 && !query ? (
              <Welcome />
            ) : (
              <>
                <ArticleList
                  articles={visible}
                  feeds={feeds}
                  selectedId={selectedId}
                  view={settings.view}
                  onSelect={select}
                  hasFeeds={feeds.length > 0}
                  onAddFeed={() => setAddFeedOpen(true)}
                />
                {limit < filtered.length && (
                  <div className="flex justify-center py-4">
                    <button
                      type="button"
                      onClick={() => setLimit((current) => current + PAGE_SIZE)}
                      className="btn btn-outline px-3 py-1.5 text-[11.5px]"
                    >
                      {t('list.loadMore')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section className={cn('min-h-0 min-w-0 flex-1 bg-bg', !selected && 'hidden lg:block')}>
          {selected ? (
            <Reader
              article={selected}
              feed={selectedFeed}
              onBack={clearSelection}
              onShowList={hideList ? () => void saveSettings({ listHidden: false }) : undefined}
              onShowSidebar={
                hideList && settings.sidebarHidden
                  ? () => void saveSettings({ sidebarHidden: false })
                  : undefined
              }
            />
          ) : (
            <ReaderPlaceholder />
          )}
        </section>
      </div>
    </>
  )
}

function ReaderPlaceholder() {
  const t = useT()
  const feeds = useAppStore((state) => state.feeds)
  const setAddFeedOpen = useAppStore((state) => state.setAddFeedOpen)
  return (
    <div className="flex h-full flex-col items-center justify-center px-10 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Rss size={24} />
      </div>
      <p className="text-[14px] font-medium text-fg">{t('reader.empty.title')}</p>
      <p className="mt-1.5 max-w-xs text-[12.5px] leading-relaxed text-muted">{t('reader.empty.desc')}</p>
      {/*<p className="mt-6 max-w-sm text-[11px] leading-relaxed text-subtle">{t('reader.empty.shortcuts')}</p>*/}
      {feeds.length === 0 && (
        <button
          type="button"
          onClick={() => setAddFeedOpen(true)}
          className="btn btn-primary mt-5 px-4 py-2 text-[12px]"
        >
          {t('welcome.add')}
        </button>
      )}
    </div>
  )
}
