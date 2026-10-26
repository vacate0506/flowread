import { memo, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Headphones,
  Languages,
  SearchX,
  Share2,
  Sparkles,
  Star,
  Volume2,
  VolumeX,
} from 'lucide-react'
import type { Article, Feed } from '../types'
import { useAppStore } from '../lib/store'
import { useT } from '../lib/useT'
import { cn, copyText, formatRelativeTime, imageProxyUrl } from '../lib/utils'
import { openExternal } from '../lib/platform'
import { toggleSpeech, useSpeechState } from '../lib/speech'
import { groupArticles, GROUP_ORDER } from '../lib/selectors'
import { FeedIcon } from './FeedIcon'
import { EmptyState } from './ui'
import { ContextMenu, type ContextMenuSection } from './ContextMenu'
import { ArticleSummaryCard } from './ArticleSummaryCard'

interface ArticleListProps {
  articles: Article[]
  feeds: Feed[]
  selectedId: string | null
  view: 'card' | 'compact'
  onSelect: (articleId: string) => void
  hasFeeds: boolean
  onAddFeed: () => void
}

export function ArticleList({ articles, feeds, selectedId, view, onSelect, hasFeeds, onAddFeed }: ArticleListProps) {
  const t = useT()
  const feedMap = useMemo(() => new Map(feeds.map((feed) => [feed.id, feed])), [feeds])
  const groups = useMemo(() => groupArticles(articles), [articles])

  if (articles.length === 0) {
    return hasFeeds ? (
      <EmptyState
        icon={<SearchX size={20} />}
        title={t('list.noResult.title')}
        description={t('list.noResult.desc')}
      />
    ) : (
      <EmptyState
        icon={<BookOpen size={20} />}
        title={t('list.empty.title')}
        description={t('list.empty.desc')}
        action={
          <button type="button" onClick={onAddFeed} className="btn btn-primary px-3.5 py-1.5 text-xs">
            {t('welcome.add')}
          </button>
        }
      />
    )
  }

  return (
    <div className="pb-16">
      {GROUP_ORDER.filter((key) => groups.some((group) => group.key === key)).map((key) => {
        const group = groups.find((candidate) => candidate.key === key)
        if (!group) return null
        return (
          <div key={key}>
            <div className="sticky top-0 z-10 bg-bg/92 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle backdrop-blur">
              {t(`list.group.${key}`)}
            </div>
            {group.articles.map((article) => (
              <ArticleListItem
                key={article.id}
                article={article}
                feed={feedMap.get(article.feedId)}
                selected={article.id === selectedId}
                view={view}
                onSelect={onSelect}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

interface ArticleListItemProps {
  article: Article
  feed?: Feed
  selected: boolean
  view: 'card' | 'compact'
  onSelect: (articleId: string) => void
}

export const ArticleListItem = memo(function ArticleListItem({
  article,
  feed,
  selected,
  view,
  onSelect,
}: ArticleListItemProps) {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const locale = useAppStore((state) => state.settings.locale)
  const apiBase = useAppStore((state) => state.settings.apiBase)
  const toggleStar = useAppStore((state) => state.toggleStar)
  const markRead = useAppStore((state) => state.markRead)
  const toast = useAppStore((state) => state.toast)
  const speech = useSpeechState()

  const [imageFailed, setImageFailed] = useState(false)
  const [summaryAnchor, setSummaryAnchor] = useState<DOMRect | null>(null)
  const [shareAnchor, setShareAnchor] = useState<DOMRect | null>(null)
  const compact = view === 'compact'
  const showImage = !compact && Boolean(article.imageUrl) && !imageFailed
  const speaking = speech.articleId === article.id && speech.status === 'playing'

  const openArticleWith = (param?: 'translate'): void => {
    const params = new URLSearchParams(location.search)
    params.set('a', article.id)
    if (param) params.set(param, '1')
    navigate({ pathname: location.pathname, search: params.toString() })
  }

  const shareSections: ContextMenuSection[] = [
    {
      items: [
        {
          id: 'copy',
          label: t('actions.copyLink'),
          icon: <Copy size={13} />,
          onSelect: () => {
            void copyText(article.link).then((ok) => {
              if (ok) toast(t('toast.copied'), 'success')
            })
          },
        },
        {
          id: 'open',
          label: t('actions.openNewWindow'),
          icon: <ExternalLink size={13} />,
          onSelect: () => void openExternal(article.link),
        },
      ],
    },
  ]

  return (
    <article
      onClick={() => onSelect(article.id)}
      className={cn(
        'group relative cursor-pointer border-b border-line/70 transition-colors',
        compact ? 'px-4 py-2.5' : 'px-4 py-3.5',
        selected ? 'bg-accent-soft' : 'hover:bg-hover',
      )}
      aria-current={selected ? 'true' : undefined}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-[2.5px] bg-accent" />}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-subtle">
            {feed && <FeedIcon feed={feed} size={13} />}
            <span className="max-w-[42%] truncate">{feed?.title ?? ''}</span>
            <span className="text-subtle/60">·</span>
            <time className="shrink-0">{formatRelativeTime(article.publishedAt ?? article.savedAt, locale)}</time>
            {!article.read && <span className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
            {article.starred && <Star size={10} fill="currentColor" className="shrink-0 text-accent" />}
            {article.aiSummary && (
              <span className="ml-auto shrink-0 rounded bg-accent-soft px-1 py-px text-[9.5px] font-semibold text-accent">
                AI
              </span>
            )}
          </div>
          <h3
            className={cn(
              'leading-snug tracking-[-0.006em]',
              compact ? 'line-clamp-1 text-[13.5px]' : 'line-clamp-2 text-[14.5px]',
              article.read ? 'font-medium text-muted' : 'font-semibold text-fg',
            )}
          >
            {article.title}
          </h3>
          {!compact && article.summary && (
            <p className="mt-1 line-clamp-2 pr-2 text-[12.5px] leading-relaxed text-subtle">{article.summary}</p>
          )}
        </div>
        {showImage && (
          <img
            src={article.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(event) => {
              const image = event.currentTarget
              if (image.dataset.proxied) {
                setImageFailed(true)
                return
              }
              image.dataset.proxied = '1'
              image.src = imageProxyUrl(article.imageUrl!, apiBase)
            }}
            className="h-[64px] w-[64px] shrink-0 rounded-lg bg-hover object-cover"
          />
        )}
      </div>

      {article.audioUrl && !compact && (
        <div className="mt-1.5 flex items-center gap-1 text-[10.5px] text-subtle">
          <Headphones size={10} />
          <span>播客</span>
        </div>
      )}

      {/* Hover action bar, mirroring Folo: summarize / translate / listen / share / star / read */}
      <div
        className={cn(
          'pointer-events-none absolute bottom-1.5 right-1.5 z-10 hidden items-center gap-0.5 rounded-full border border-line bg-surface/95 p-0.5 opacity-0 shadow-md backdrop-blur',
          'transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 sm:flex',
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <ToolButton
          label={t('actions.summary')}
          active={Boolean(article.aiSummary)}
          onClick={(event) => {
            setSummaryAnchor(event.currentTarget.getBoundingClientRect())
          }}
        >
          <Sparkles size={13} />
        </ToolButton>
        <ToolButton
          label={t('actions.translate')}
          onClick={() => {
            openArticleWith('translate')
          }}
        >
          <Languages size={13} />
        </ToolButton>
        <ToolButton
          label={speaking ? t('actions.stopListening') : t('actions.listen')}
          active={speaking}
          onClick={() => toggleSpeech(article)}
        >
          {speaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </ToolButton>
        <ToolButton
          label={t('actions.share')}
          onClick={(event) => {
            setShareAnchor(event.currentTarget.getBoundingClientRect())
          }}
        >
          <Share2 size={13} />
        </ToolButton>
        <span className="mx-0.5 h-3.5 w-px bg-line" />
        <ToolButton
          label={article.starred ? t('reader.unstar') : t('reader.star')}
          active={article.starred}
          onClick={() => void toggleStar(article.id)}
        >
          <Star size={13} fill={article.starred ? 'currentColor' : 'none'} />
        </ToolButton>
        <ToolButton
          label={article.read ? t('actions.markUnread') : t('actions.markRead')}
          active={article.read}
          onClick={() => void markRead(article.id, !article.read)}
        >
          {article.read ? <Circle size={13} /> : <CheckCircle2 size={13} />}
        </ToolButton>
      </div>

      {summaryAnchor && (
        <ArticleSummaryCard
          article={article}
          feed={feed}
          anchor={summaryAnchor}
          onClose={() => setSummaryAnchor(null)}
        />
      )}

      {shareAnchor && (
        <ContextMenu
          open
          x={shareAnchor.left}
          y={shareAnchor.bottom + 6}
          sections={shareSections}
          onClose={() => setShareAnchor(null)}
        />
      )}
    </article>
  )
})

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick(event)
      }}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-full text-subtle transition-colors',
        'hover:bg-hover hover:text-fg',
        active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
      )}
    >
      {children}
    </button>
  )
}
