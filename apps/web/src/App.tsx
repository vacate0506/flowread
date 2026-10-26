import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { TimelinePage } from './components/TimelinePage'
import { SubscriptionsPage } from './components/SubscriptionsPage'
import { MobileTabBar } from './components/MobileTabBar'
import { SettingsModal } from './components/SettingsModal'
import { AddFeedModal } from './components/AddFeedModal'
import { Toasts } from './components/Toasts'
import { BrandMark } from './components/FeedIcon'
import { Spinner } from './components/ui'
import { applyTheme, useAppStore } from './lib/store'
import { useT } from './lib/useT'
import { isTauri, openExternal } from './lib/platform'
import { unreadCount } from './lib/selectors'

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  )
}

function Shell() {
  const t = useT()
  const ready = useAppStore((state) => state.ready)
  const init = useAppStore((state) => state.init)
  const articles = useAppStore((state) => state.articles)
  const theme = useAppStore((state) => state.settings.theme)
  const apiBase = useAppStore((state) => state.settings.apiBase)
  const setOnline = useAppStore((state) => state.setOnline)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const toast = useAppStore((state) => state.toast)

  useEffect(() => {
    void init()
  }, [init])

  // On Android/iOS the app is served from a local scheme, so it needs an
  // explicit FlowRead server address before any feed can be loaded.
  useEffect(() => {
    if (!ready) return
    const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    if (capacitor?.isNativePlatform?.() && !apiBase) {
      setSettingsOpen(true)
      toast(t('mobile.serverRequired'), 'info')
    }
    // Only relevant for the first render after bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyTheme(theme)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  useEffect(() => {
    const onOnline = (): void => {
      setOnline(true)
      toast(t('toast.online'), 'success')
    }
    const onOffline = (): void => {
      setOnline(false)
      toast(t('toast.offline'))
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [setOnline, toast, t])

  // Desktop (Tauri) should send external links to the system browser instead
  // of trying to navigate the app shell.
  useEffect(() => {
    if (!isTauri()) return
    const onClick = (event: MouseEvent): void => {
      const anchor = (event.target as HTMLElement | null)?.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      if (!/^https?:\/\//i.test(href)) return
      event.preventDefault()
      void openExternal(href)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  const unread = unreadCount(articles)
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) FlowRead` : 'FlowRead · AI RSS 阅读器'
  }, [unread])

  if (!ready) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-bg text-fg">
        <BrandMark size={44} />
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <Spinner size={13} className="text-accent" />
          FlowRead
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-bg text-fg">
      <Sidebar />
      <main className="flex min-h-0 min-w-0 flex-1">
        <Routes>
          <Route path="/" element={<TimelinePage />} />
          <Route path="/feed/:feedId" element={<TimelinePage />} />
          <Route path="/starred" element={<TimelinePage />} />
          <Route path="/subscriptions" element={<SubscriptionsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <MobileTabBar />
      <SettingsModal />
      <AddFeedModal />
      <Toasts />
    </div>
  )
}
