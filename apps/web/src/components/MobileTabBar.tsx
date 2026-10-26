import { useMemo } from 'react'
import { Link, useSearchParams, useLocation } from 'react-router-dom'
import { BookOpen, Plus, Rss, Settings, Star } from 'lucide-react'
import { useAppStore } from '../lib/store'
import { useT } from '../lib/useT'
import { cn } from '../lib/utils'
import { unreadCount } from '../lib/selectors'

export function MobileTabBar() {
  const t = useT()
  const location = useLocation()
  const [params] = useSearchParams()
  const articles = useAppStore((state) => state.articles)
  const setAddFeedOpen = useAppStore((state) => state.setAddFeedOpen)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)

  const unread = useMemo(() => unreadCount(articles), [articles])
  const starred = useMemo(() => articles.filter((article) => article.starred).length, [articles])

  if (params.get('a')) return null

  const items = [
    { to: '/', label: t('mobile.tab.timeline'), icon: BookOpen, count: unread, active: location.pathname === '/' },
    {
      to: '/subscriptions',
      label: t('mobile.tab.feeds'),
      icon: Rss,
      count: 0,
      active: location.pathname === '/subscriptions',
    },
    {
      to: '/starred',
      label: t('mobile.tab.starred'),
      icon: Star,
      count: starred,
      active: location.pathname === '/starred',
    },
  ]

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto grid h-[54px] max-w-md grid-cols-5 items-stretch">
        {items.slice(0, 2).map((item) => (
          <TabItem key={item.to} {...item} />
        ))}
        <button
          type="button"
          onClick={() => setAddFeedOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 text-subtle"
          aria-label={t('nav.addFeed')}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-fg shadow-md shadow-accent/25">
            <Plus size={18} />
          </span>
        </button>
        {items.slice(2).map((item) => (
          <TabItem key={item.to} {...item} />
        ))}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex flex-col items-center justify-center gap-1 text-subtle"
        >
          <Settings size={18} />
          <span className="text-[9.5px] font-medium">{t('mobile.tab.settings')}</span>
        </button>
      </div>
    </nav>
  )
}

function TabItem({
  to,
  label,
  icon: Icon,
  count,
  active,
}: {
  to: string
  label: string
  icon: typeof BookOpen
  count: number
  active: boolean
}) {
  return (
    <Link
      to={to}
      className={cn(
        'relative flex flex-col items-center justify-center gap-1 transition-colors',
        active ? 'text-accent' : 'text-subtle',
      )}
    >
      <span className="relative">
        <Icon size={18} />
        {count > 0 && (
          <span className="absolute -right-2 -top-1.5 rounded-full bg-accent px-1 text-[8.5px] font-semibold leading-[13px] text-accent-fg">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      <span className={cn('text-[9.5px] font-medium', active && 'text-accent')}>{label}</span>
    </Link>
  )
}
