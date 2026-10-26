import { create } from 'zustand'
import {
  generateOpml,
  hashString,
  normalizeUrl,
  parseOpml,
  parseTranslationLine,
  stripHtml,
  type AiConfig,
  type ParsedFeed,
  type SummaryMode,
} from '@flowread/shared'
import type {
  AiState,
  Article,
  ArticleTranslation,
  Feed,
  Folder,
  RefreshProgress,
  Settings,
  ThemeMode,
  Toast,
  ToastKind,
  TranslateState,
} from '../types'
import { AI_PRESETS } from '@flowread/shared'
import { DEFAULT_SETTINGS, DEFAULT_AI } from '../types'
import { getRepository } from './repository'
import * as api from './api'
import { ApiError } from './api'
import { normalizeFeedOrder, nextSortIndex, sortFeeds, moveFeedTo, type FeedDropTarget } from './feedOrder'
import { buildBackup, parseBackup } from './backup'
import { proxyForAi, proxyForFeed } from './proxy'

let importInProgress = false
import {
  chunkBy,
  prepareArticleHtml,
  readingMinutes,
  uid,
  downloadBlob,
  sanitizeArticleHtml,
} from './utils'
import { setLocale, t } from './i18n'

const MAX_ARTICLES_PER_FEED = 400
const REFRESH_CONCURRENCY = 4
const TRANSLATE_BATCH_BLOCKS = 8
const TRANSLATE_BATCH_CHARS = 1600

let aiAbort: AbortController | undefined
let translateAbort: AbortController | undefined

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function articleTime(article: Article): number {
  return article.publishedAt ?? article.savedAt
}

export function sortArticles(articles: Article[]): Article[] {
  return [...articles].sort((a, b) => articleTime(b) - articleTime(a))
}

function mergeArticles(existing: Article[], incoming: Article[]): Article[] {
  if (incoming.length === 0) return existing
  const map = new Map(existing.map((article) => [article.id, article]))
  for (const article of incoming) map.set(article.id, article)
  return sortArticles([...map.values()])
}

function normalizeLink(link: string): string {
  return link.trim().replace(/#.*$/, '').replace(/\/+$/, '')
}

function makeArticleId(feedId: string, guid: string): string {
  return `${hashString(`${feedId}|${guid}`)}${hashString(`${guid}|${feedId}|flowread`)}`
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of items) map.set(item.id, item)
  return [...map.values()]
}

function mapItems(feedId: string, items: ParsedFeed['items']): Article[] {
  const now = Date.now()
  return items.map((item) => {
    const guid = item.guid || item.link || item.title
    return {
      id: makeArticleId(feedId, guid),
      feedId,
      guid,
      title: item.title,
      link: item.link,
      summary: item.summary,
      contentHtml: item.contentHtml,
      ...(item.author ? { author: item.author } : {}),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
      ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
      categories: item.categories,
      ...(item.audioUrl ? { audioUrl: item.audioUrl } : {}),
      read: false,
      starred: false,
      savedAt: now,
      fetchedAt: now,
    } satisfies Article
  })
}

function feedFromParsed(feed: ParsedFeed, folderId: string | undefined, etag?: string, lastModified?: string): Feed {
  return {
    id: hashString(feed.url),
    url: feed.url,
    title: feed.title,
    ...(feed.siteUrl ? { siteUrl: feed.siteUrl } : {}),
    ...(feed.iconUrl ? { iconUrl: feed.iconUrl } : {}),
    ...(feed.description ? { description: feed.description } : {}),
    format: feed.format,
    ...(folderId ? { folderId } : {}),
    createdAt: Date.now(),
    lastFetchedAt: Date.now(),
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
  }
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      const item = items[index]
      if (item === undefined) return
      await worker(item)
    }
  })
  await Promise.all(runners)
}

export function applyTheme(mode: ThemeMode): void {
  const dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  try {
    localStorage.setItem('flowread.theme', mode)
  } catch {
    /* ignore */
  }
}

export function aiNeedsKey(ai: AiConfig): boolean {
  return ['deepseek', 'openai', 'siliconflow'].includes(ai.provider) && !ai.apiKey.trim()
}

async function pruneFeed(feedId: string): Promise<string[]> {
  const repository = await getRepository()
  const all = await repository.articlesByFeed(feedId)
  if (all.length <= MAX_ARTICLES_PER_FEED) return []
  const sorted = [...all].sort((a, b) => articleTime(b) - articleTime(a))
  const keep = new Set(sorted.slice(0, MAX_ARTICLES_PER_FEED).map((article) => article.id))
  const remove = all
    .filter((article) => !keep.has(article.id) && !article.starred && !article.aiSummary)
    .map((article) => article.id)
  if (remove.length > 0) await repository.deleteArticles(remove)
  return remove
}

/* -------------------------------------------------------------------------- */
/* Store                                                                      */
/* -------------------------------------------------------------------------- */

interface AppStore {
  ready: boolean
  feeds: Feed[]
  folders: Folder[]
  articles: Article[]
  settings: Settings
  selectedArticleId: string | null
  query: string
  sidebarOpen: boolean
  sidebarCollapsed: boolean
  settingsOpen: boolean
  addFeedOpen: boolean
  refreshing: RefreshProgress
  toasts: Toast[]
  ai: AiState
  translate: TranslateState
  online: boolean

  init: () => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  toast: (message: string, kind?: ToastKind) => void
  dismissToast: (id: string) => void
  setQuery: (query: string) => void
  setSidebarOpen: (open: boolean) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setAddFeedOpen: (open: boolean) => void

  addFeed: (url: string, folderId?: string, useProxy?: boolean) => Promise<{ feed: Feed; count: number }>
  setFeedProxy: (feedId: string, useProxy: boolean) => Promise<void>
  importOpml: (
    text: string,
    options?: { allowUnverified?: boolean },
  ) => Promise<{
    feeds: number
    articles: number
    skipped: { title: string; url: string; error: string }[]
  }>
  exportOpml: () => void
  loadSampleFeeds: () => Promise<{
    feeds: number
    articles: number
    skipped: { title: string; url: string; error: string }[]
  }>
  refreshAll: () => Promise<void>
  refreshFeed: (feedId: string) => Promise<number>
  removeFeed: (feedId: string, options?: { silent?: boolean }) => Promise<void>
  renameFeed: (feedId: string, title: string) => Promise<void>
  editFeed: (
    feedId: string,
    patch: {
      title?: string
      url?: string
      folderId?: string | null
      useProxy?: boolean
    },
  ) => Promise<void>
  dropFeed: (feedId: string, target: FeedDropTarget) => Promise<void>
  exportBackup: (includeKey: boolean) => string
  importBackup: (text: string) => Promise<{ feeds: number; folders: number }>
  createFolder: (name: string) => Promise<Folder>
  renameFolder: (folderId: string, name: string) => Promise<void>
  deleteFolder: (folderId: string) => Promise<void>
  moveFeed: (feedId: string, folderId: string | undefined) => Promise<void>
  clearData: () => Promise<void>

  selectArticle: (articleId: string | null) => void
  markRead: (articleId: string, read: boolean) => Promise<void>
  toggleStar: (articleId: string) => Promise<void>
  markAllRead: (feedId?: string) => Promise<void>

  ensureFullText: (articleId: string) => Promise<string>
  summarize: (articleId: string, mode: SummaryMode) => Promise<void>
  stopSummary: () => void
  translateArticle: (articleId: string, targetLanguage: string, mode?: 'bilingual' | 'translated') => Promise<void>
  clearTranslation: (articleId: string, targetLanguage: string) => Promise<void>
  stopTranslation: () => void
  setTranslateMode: (mode: 'bilingual' | 'translated') => void
  setOnline: (online: boolean) => void
}

export const useAppStore = create<AppStore>((set, get) => ({
  ready: false,
  feeds: [],
  folders: [],
  articles: [],
  settings: DEFAULT_SETTINGS,
  selectedArticleId: null,
  query: '',
  sidebarOpen: false,
  sidebarCollapsed: false,
  settingsOpen: false,
  addFeedOpen: false,
  refreshing: { running: false, done: 0, total: 0, failed: 0, newArticles: 0 },
  toasts: [],
  ai: { status: 'idle', mode: 'key-points', text: '' },
  translate: { targetLanguage: 'zh-CN', mode: 'bilingual', status: 'idle', doneBlocks: 0, totalBlocks: 0 },
  online: true,

  init: async () => {
    const repository = await getRepository()
    await repository.init()
    const snapshot = await repository.loadAll()
    const feeds = uniqueById(snapshot.feeds)
    const folders = uniqueById(snapshot.folders)
    const articles = uniqueById(snapshot.articles)
    const stored = (snapshot.settings ?? {}) as Partial<Settings>
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      ai: { ...DEFAULT_AI, ...(stored.ai ?? {}) },
      proxy: { ...DEFAULT_SETTINGS.proxy, ...(stored.proxy ?? {}) },
    }
    setLocale(settings.locale)
    applyTheme(settings.theme)
    // Older installs have no explicit feed order: derive one from the current
    // title order so drag & drop starts from a stable baseline.
    const needsOrder = feeds.some((feed) => feed.sortIndex == null)
    const orderedFeeds = needsOrder ? normalizeFeedOrder(feeds) : sortFeeds(feeds)
    if (needsOrder) await repository.putFeeds(orderedFeeds)
    set({
      feeds: orderedFeeds,
      folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
      articles: sortArticles(articles),
      settings,
      ready: true,
      online: navigator.onLine,
    })
    const lastFetched = feeds.reduce((latest, feed) => Math.max(latest, feed.lastFetchedAt ?? 0), 0)
    const interval = settings.refreshMinutes * 60_000
    if (feeds.length > 0 && interval > 0 && Date.now() - lastFetched > interval) {
      void get().refreshAll()
    }
  },

  saveSettings: async (patch) => {
    const settings: Settings = { ...get().settings, ...patch }
    if (patch.theme) applyTheme(settings.theme)
    if (patch.locale) setLocale(settings.locale)
    set({ settings })
    const repository = await getRepository()
    await repository.putSettings(settings)
  },

  toast: (message, kind = 'info') => {
    const toast: Toast = { id: uid(), kind, message }
    set((state) => ({ toasts: [...state.toasts.slice(-3), toast] }))
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((item) => item.id !== toast.id) }))
    }, 4200)
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  setQuery: (query) => set({ query }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAddFeedOpen: (addFeedOpen) => set({ addFeedOpen }),
  setOnline: (online) => set({ online }),

  addFeed: async (url, folderId, useProxy) => {
    const { settings } = get()
    const proxy = proxyForFeed(settings, { useProxy: Boolean(useProxy) })
    const result = await api.fetchFeed(url, settings.apiBase, { proxy })
    if (!result.feed) throw new Error(result.error ?? t('add.fail'))
    const parsed = result.feed
    const feed = feedFromParsed(parsed, folderId, result.etag, result.lastModified)
    feed.sortIndex = nextSortIndex(get().feeds)
    if (useProxy) feed.useProxy = true
    const existing = get().feeds.find((candidate) => candidate.id === feed.id || candidate.url === feed.url)
    if (existing) {
      const count = await get().refreshFeed(existing.id)
      return { feed: existing, count }
    }
    const articles = mapItems(feed.id, parsed.items)
    const repository = await getRepository()
    await repository.putFeed(feed)
    await repository.putArticles(articles)
    set((state) => ({
      feeds: sortFeeds([...state.feeds, feed]),
      articles: mergeArticles(state.articles, articles),
    }))
    await pruneFeed(feed.id)
    return { feed, count: articles.length }
  },

  setFeedProxy: async (feedId, useProxy) => {
    await (await getRepository()).updateFeed(feedId, useProxy ? { useProxy: true } : { useProxy: undefined })
    set((state) => ({
      feeds: state.feeds.map((feed) => (feed.id === feedId ? { ...feed, useProxy: useProxy || undefined } : feed)),
    }))
    get().toast(t(useProxy ? 'proxy.feedEnabled' : 'proxy.feedDisabled'), 'success')
  },

  importOpml: async (text, options) => {
    if (importInProgress) throw new Error(t('onboarding.importing'))
    importInProgress = true
    try {
    const document = parseOpml(text)
    const settings = get().settings
    const existingUrls = new Set(get().feeds.map((feed) => feed.url))
    const existingIds = new Set(get().feeds.map((feed) => feed.id))
    const folderByName = new Map(get().folders.map((folder) => [folder.name, folder]))
    const newFolders: Folder[] = []
    const candidates: {
      id: string
      url: string
      title: string
      siteUrl?: string
      folderId?: string
      sortIndex: number
    }[] = []
    let sortIndex = nextSortIndex(get().feeds)

    for (const entry of document.feeds) {
      if (existingUrls.has(entry.xmlUrl)) continue
      const id = hashString(entry.xmlUrl)
      if (existingIds.has(id)) continue
      existingUrls.add(entry.xmlUrl)
      existingIds.add(id)
      const folderName = entry.folder
      let folderId: string | undefined
      if (folderName) {
        let folder = folderByName.get(folderName)
        if (!folder) {
          folder = { id: hashString(`folder:${folderName}`), name: folderName, createdAt: Date.now() }
          folderByName.set(folderName, folder)
          newFolders.push(folder)
        }
        folderId = folder.id
      }
      candidates.push({
        id,
        url: entry.xmlUrl,
        title: entry.title || entry.xmlUrl,
        ...(entry.htmlUrl ? { siteUrl: entry.htmlUrl } : {}),
        ...(folderId ? { folderId } : {}),
        sortIndex,
      })
      sortIndex += 100
    }

    const skipped: { title: string; url: string; error: string }[] = []
    const imported: { feed: Feed; articles: Article[] }[] = []

    // Validate every subscription before storing it: unreachable / malformed
    // feeds must not be added to the database.
    if (options?.allowUnverified) {
      for (const candidate of candidates) {
        imported.push({
          feed: {
            id: candidate.id,
            url: candidate.url,
            title: candidate.title,
            ...(candidate.siteUrl ? { siteUrl: candidate.siteUrl } : {}),
            format: 'rss',
            ...(candidate.folderId ? { folderId: candidate.folderId } : {}),
            createdAt: Date.now(),
            sortIndex: candidate.sortIndex,
            lastError: t('onboarding.unverifiedError'),
          },
          articles: [],
        })
      }
    } else {
      await runPool(candidates, 4, async (candidate) => {
      try {
        const proxy = proxyForFeed(settings, { useProxy: false })
        const result = await api.fetchFeed(candidate.url, settings.apiBase, {
          autoDiscover: false,
          ...(proxy ? { proxy } : {}),
        })
        if (!result.feed) throw new Error(result.error ?? '无法解析订阅源')
        const feed = feedFromParsed(result.feed, candidate.folderId, result.etag, result.lastModified)
        feed.id = candidate.id
        feed.sortIndex = candidate.sortIndex
        feed.title = result.feed.title || candidate.title
        imported.push({ feed, articles: mapItems(feed.id, result.feed.items) })
      } catch (error) {
        skipped.push({
          title: candidate.title,
          url: candidate.url,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
    }

    const usedFolderIds = new Set(imported.map(({ feed }) => feed.folderId).filter(Boolean))
    const folders = newFolders.filter((folder) => usedFolderIds.has(folder.id))
    const repository = await getRepository()
    if (folders.length > 0) await repository.putFolders(folders)
    if (imported.length > 0) {
      await repository.putFeeds(imported.map(({ feed }) => feed))
      await repository.putArticles(imported.flatMap(({ articles }) => articles))
    }

    set((state) => {
      const folderMap = new Map(state.folders.map((folder) => [folder.id, folder]))
      for (const folder of folders) folderMap.set(folder.id, folder)
      const feedMap = new Map(state.feeds.map((feed) => [feed.id, feed]))
      for (const { feed } of imported) feedMap.set(feed.id, feed)
      return {
        folders: [...folderMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
        feeds: sortFeeds([...feedMap.values()]),
        articles: mergeArticles(
          state.articles,
          imported.flatMap(({ articles }) => articles),
        ),
      }
    })

    return {
      feeds: imported.length,
      articles: imported.reduce((sum, item) => sum + item.articles.length, 0),
      skipped,
    }
    } finally {
      importInProgress = false
    }
  },

  exportOpml: () => {
    const { feeds, folders } = get()
    const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]))
    const xml = generateOpml(
      feeds.map((feed) => ({
        title: feed.title,
        url: feed.url,
        ...(feed.siteUrl ? { siteUrl: feed.siteUrl } : {}),
        ...(feed.folderId && folderNames.has(feed.folderId) ? { folder: folderNames.get(feed.folderId)! } : {}),
      })),
    )
    downloadBlob(xml, `flowread-subscriptions-${new Date().toISOString().slice(0, 10)}.opml`, 'text/x-opml')
    get().toast(t('toast.exported'), 'success')
  },

  loadSampleFeeds: async () => {
    const response = await fetch('/sample-subscriptions.opml')
    if (!response.ok) throw new Error('sample not found')
    const text = await response.text()
    return get().importOpml(text)
  },

  refreshAll: async () => {
    const { feeds, settings } = get()
    if (feeds.length === 0) return
    if (get().refreshing.running) return
    set({
      refreshing: { running: true, done: 0, total: feeds.length, failed: 0, newArticles: 0 },
    })

    let done = 0
    let failed = 0
    let newArticles = 0
    const feedUpdates: Feed[] = []
    const articleUpdates: Article[] = []
    const removed: string[] = []

    await runPool(feeds, REFRESH_CONCURRENCY, async (feed) => {
      try {
        const outcome = await refreshOne(feed, settings)
        if (outcome) {
          feedUpdates.push(outcome.feed)
          articleUpdates.push(...outcome.articles)
          removed.push(...outcome.removed)
          newArticles += outcome.newCount
        }
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        const updated: Feed = { ...feed, lastError: message }
        feedUpdates.push(updated)
        await (await getRepository()).putFeed(updated)
      } finally {
        done += 1
        set((state) => ({ refreshing: { ...state.refreshing, done, failed, newArticles } }))
      }
    })

    set((state) => {
      const feedMap = new Map(state.feeds.map((feed) => [feed.id, feed]))
      for (const feed of feedUpdates) feedMap.set(feed.id, feed)
      const removedSet = new Set(removed)
      const kept = state.articles.filter((article) => !removedSet.has(article.id))
      return {
        feeds: sortFeeds([...feedMap.values()]),
        articles: mergeArticles(kept, articleUpdates),
        refreshing: { running: false, done, total: feeds.length, failed, newArticles },
      }
    })

    if (failed > 0) get().toast(t('toast.refreshFailed', { n: failed }), 'error')
    if (newArticles === 0 && failed === 0) get().toast(t('toast.noNew'))
  },

  refreshFeed: async (feedId) => {
    const { feeds, settings } = get()
    const feed = feeds.find((candidate) => candidate.id === feedId)
    if (!feed) return 0
    try {
      const outcome = await refreshOne(feed, settings)
      if (!outcome) return 0
      set((state) => {
        const removedSet = new Set(outcome.removed)
        return {
          feeds: state.feeds.map((candidate) => (candidate.id === feedId ? outcome.feed : candidate)),
          articles: mergeArticles(
            state.articles.filter((article) => !removedSet.has(article.id)),
            outcome.articles,
          ),
        }
      })
      return outcome.newCount
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const updated: Feed = { ...feed, lastError: message }
      await (await getRepository()).putFeed(updated)
      set((state) => ({
        feeds: state.feeds.map((candidate) => (candidate.id === feedId ? updated : candidate)),
      }))
      get().toast(`${t('subs.feed.error', { msg: message })}`, 'error')
      return 0
    }
  },

  removeFeed: async (feedId, options) => {
    const repository = await getRepository()
    await repository.deleteFeed(feedId)
    set((state) => ({
      feeds: state.feeds.filter((feed) => feed.id !== feedId),
      articles: state.articles.filter((article) => article.feedId !== feedId),
      selectedArticleId: state.selectedArticleId
        ? state.articles.find((article) => article.id === state.selectedArticleId)?.feedId === feedId
          ? null
          : state.selectedArticleId
        : null,
    }))
    if (!options?.silent) get().toast(t('toast.feedDeleted'))
  },

  createFolder: async (name) => {
    const folder: Folder = { id: uid(), name: name.trim(), createdAt: Date.now() }
    await (await getRepository()).putFolder(folder)
    set((state) => ({ folders: [...state.folders, folder].sort((a, b) => a.name.localeCompare(b.name)) }))
    get().toast(t('toast.folderCreated'), 'success')
    return folder
  },

  renameFolder: async (folderId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    await (await getRepository()).updateFolder(folderId, { name: trimmed })
    set((state) => ({
      folders: state.folders
        .map((folder) => (folder.id === folderId ? { ...folder, name: trimmed } : folder))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
  },

  deleteFolder: async (folderId) => {
    const affected = get().feeds.filter((feed) => feed.folderId === folderId)
    const repository = await getRepository()
    await repository.deleteFolder(folderId)
    for (const feed of affected) await repository.updateFeed(feed.id, { folderId: undefined })
    set((state) => ({
      folders: state.folders.filter((folder) => folder.id !== folderId),
      feeds: state.feeds.map((feed) => (feed.folderId === folderId ? { ...feed, folderId: undefined } : feed)),
    }))
    get().toast(t('toast.folderDeleted'))
  },

  moveFeed: async (feedId, folderId) => {
    await (await getRepository()).updateFeed(feedId, { folderId })
    set((state) => ({
      feeds: state.feeds.map((feed) => (feed.id === feedId ? { ...feed, folderId } : feed)),
    }))
  },

  renameFeed: async (feedId, title) => {
    const trimmed = title.trim()
    if (!trimmed) return
    await (await getRepository()).updateFeed(feedId, { title: trimmed, titleLocked: true })
    set((state) => ({
      feeds: state.feeds.map((feed) =>
        feed.id === feedId ? { ...feed, title: trimmed, titleLocked: true } : feed,
      ),
    }))
    get().toast(t('toast.feedRenamed'), 'success')
  },

  editFeed: async (feedId, patch) => {
    const state = get()
    const feed = state.feeds.find((candidate) => candidate.id === feedId)
    if (!feed) throw new Error(t('edit.notFound'))

    const target = normalizeUrl((patch.url ?? feed.url).trim())
    if (!target) throw new Error(t('edit.invalidUrl'))
    if (target !== feed.url && state.feeds.some((other) => other.id !== feedId && other.url === target)) {
      throw new Error(t('edit.duplicate'))
    }

    const useProxy = patch.useProxy ?? feed.useProxy
    const folderId = patch.folderId === undefined ? feed.folderId : patch.folderId ?? undefined
    let updated: Feed
    let newArticles: Article[] = []

    if (target !== feed.url) {
      const proxy = proxyForFeed(state.settings, { useProxy })
      const result = await api.fetchFeed(target, state.settings.apiBase, {
        ...(proxy ? { proxy } : {}),
      })
      if (!result.feed) throw new Error(result.error ?? t('edit.fetchFailed'))
      const parsed = result.feed
      if (parsed.url !== target && state.feeds.some((other) => other.id !== feedId && other.url === parsed.url)) {
        throw new Error(t('edit.duplicate'))
      }
      const title = patch.title?.trim() || parsed.title || feed.title
      updated = {
        ...feed,
        url: parsed.url,
        title,
        titleLocked: Boolean(patch.title?.trim()) && patch.title!.trim() !== (parsed.title ?? ''),
        siteUrl: parsed.siteUrl ?? feed.siteUrl,
        iconUrl: parsed.iconUrl ?? feed.iconUrl,
        description: parsed.description ?? feed.description,
        format: parsed.format,
        folderId,
        useProxy: useProxy || undefined,
        etag: result.etag,
        lastModified: result.lastModified,
        lastFetchedAt: Date.now(),
        lastError: undefined,
      }
      newArticles = mapItems(feed.id, parsed.items)
    } else {
      const title = patch.title?.trim() || feed.title
      updated = {
        ...feed,
        title,
        titleLocked: title !== feed.title ? true : feed.titleLocked,
        folderId,
        useProxy: useProxy || undefined,
      }
    }

    const repository = await getRepository()
    await repository.updateFeed(feedId, updated)
    if (newArticles.length > 0) await repository.putArticles(newArticles)
    set((current) => ({
      feeds: current.feeds.map((candidate) => (candidate.id === feedId ? updated : candidate)),
      articles: mergeArticles(current.articles, newArticles),
    }))
    get().toast(t('edit.saved'), 'success')
  },

  dropFeed: async (feedId, target) => {
    const previous = new Map(get().feeds.map((feed) => [feed.id, feed]))
    const next = moveFeedTo(get().feeds, feedId, target)
    const changed = next.filter((feed) => {
      const old = previous.get(feed.id)
      return !old || old.sortIndex !== feed.sortIndex || old.folderId !== feed.folderId
    })
    await (await getRepository()).putFeeds(changed)
    set({ feeds: next })
  },

  exportBackup: (includeKey) => {
    const { settings, folders, feeds } = get()
    return JSON.stringify(buildBackup({ settings, folders, feeds, includeKey }), null, 2)
  },

  importBackup: async (text) => {
    const backup = parseBackup(text)
    const current = get().settings
    const settings: Settings = {
      ...current,
      ...backup.settings,
      ai: {
        ...current.ai,
        ...backup.settings.ai,
        // Never wipe an existing key with an empty one from a key-less backup.
        apiKey: backup.settings.ai.apiKey.trim() || current.ai.apiKey,
      },
    }
    setLocale(settings.locale)
    applyTheme(settings.theme)
    const repository = await getRepository()
    await repository.putFolders(backup.folders)
    await repository.putFeeds(backup.feeds)
    await repository.putSettings(settings)

    const foldersById = new Map(get().folders.map((folder) => [folder.id, folder]))
    for (const folder of backup.folders) foldersById.set(folder.id, folder)
    const feedsById = new Map(get().feeds.map((feed) => [feed.id, feed]))
    for (const feed of backup.feeds) feedsById.set(feed.id, feed)
    let feeds = sortFeeds([...feedsById.values()])
    if (feeds.some((feed) => feed.sortIndex == null)) {
      feeds = normalizeFeedOrder(feeds)
      await repository.putFeeds(feeds)
    }

    set({
      settings,
      feeds,
      folders: [...foldersById.values()].sort((a, b) => a.name.localeCompare(b.name)),
    })
    get().toast(t('backup.imported', { feeds: backup.feeds.length, folders: backup.folders.length }), 'success')
    return { feeds: backup.feeds.length, folders: backup.folders.length }
  },

  clearData: async () => {
    await (await getRepository()).clearAll()
    set({ feeds: [], folders: [], articles: [], selectedArticleId: null, query: '' })
    get().toast(t('toast.cleared'), 'success')
  },

  selectArticle: (articleId) => {
    set({ selectedArticleId: articleId })
    const { settings } = get()
    if (articleId && settings.markReadOnOpen) {
      const article = get().articles.find((candidate) => candidate.id === articleId)
      if (article && !article.read) void get().markRead(articleId, true)
    }
  },

  markRead: async (articleId, read) => {
    await (await getRepository()).updateArticle(articleId, { read })
    set((state) => ({
      articles: state.articles.map((article) => (article.id === articleId ? { ...article, read } : article)),
    }))
  },

  toggleStar: async (articleId) => {
    const article = get().articles.find((candidate) => candidate.id === articleId)
    if (!article) return
    const starred = !article.starred
    await (await getRepository()).updateArticle(articleId, { starred })
    set((state) => ({
      articles: state.articles.map((candidate) =>
        candidate.id === articleId ? { ...candidate, starred } : candidate,
      ),
    }))
  },

  markAllRead: async (feedId) => {
    const ids = get()
      .articles.filter((article) => !article.read && (!feedId || article.feedId === feedId))
      .map((article) => article.id)
    if (ids.length === 0) return
    await (await getRepository()).updateArticles(ids, { read: true })
    const idSet = new Set(ids)
    set((state) => ({
      articles: state.articles.map((article) => (idSet.has(article.id) ? { ...article, read: true } : article)),
    }))
    get().toast(t('list.markedAllRead'), 'success')
  },

  ensureFullText: async (articleId) => {
    const article = get().articles.find((candidate) => candidate.id === articleId)
    if (!article) return ''
    if (article.extractedHtml) return article.extractedHtml
    const plain = stripHtml(article.contentHtml)
    if (!get().settings.autoExtract || plain.length > 1200 || !article.link) return article.contentHtml
    try {
      const feed = get().feeds.find((candidate) => candidate.id === article.feedId)
      const extracted = await api.extractArticle(
        article.link,
        get().settings.apiBase,
        proxyForFeed(get().settings, feed),
      )
      const html = sanitizeArticleHtml(extracted.html)
      const extractedAt = Date.now()
      await (await getRepository()).updateArticle(articleId, { extractedHtml: html, extractedAt })
      set((state) => ({
        articles: state.articles.map((candidate) =>
          candidate.id === articleId ? { ...candidate, extractedHtml: html, extractedAt } : candidate,
        ),
      }))
      return html
    } catch {
      return article.contentHtml
    }
  },

  summarize: async (articleId, mode) => {
    const { settings } = get()
    const article = get().articles.find((candidate) => candidate.id === articleId)
    if (!article) return
    if (!settings.ai.baseUrl.trim() || !settings.ai.model.trim() || aiNeedsKey(settings.ai)) {
      get().toast(t('ai.needConfig'), 'error')
      get().setSettingsOpen(true)
      return
    }
    aiAbort?.abort()
    aiAbort = new AbortController()
    set({ ai: { articleId, status: 'running', mode, text: '', model: settings.ai.model } })

    try {
      const html = await get().ensureFullText(articleId)
      const content = stripHtml(html)
      await api.summarizeStream(
        {
          title: article.title,
          content,
          mode,
          language: settings.aiLanguage,
          url: article.link,
        },
        {
          apiBase: settings.apiBase,
          ai: settings.ai,
          proxy: proxyForAi(settings),
          signal: aiAbort.signal,
          onDelta: (chunk) =>
            set((state) =>
              state.ai.articleId === articleId
                ? { ai: { ...state.ai, text: state.ai.text + chunk } }
                : state,
            ),
        },
      )
      const text = get().ai.articleId === articleId ? get().ai.text.trim() : ''
      if (!text) return
      const summary = {
        text,
        mode,
        model: settings.ai.model,
        language: settings.aiLanguage,
        createdAt: Date.now(),
      }
      await (await getRepository()).updateArticle(articleId, { aiSummary: summary })
      set((state) => ({
        articles: state.articles.map((candidate) =>
          candidate.id === articleId ? { ...candidate, aiSummary: summary } : candidate,
        ),
        ...(state.ai.articleId === articleId ? { ai: { ...state.ai, status: 'done' as const } } : {}),
      }))
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        set((state) => (state.ai.articleId === articleId ? { ai: { ...state.ai, status: 'idle' } } : state))
        return
      }
      const message = error instanceof ApiError ? error.message : (error as Error).message
      set((state) =>
        state.ai.articleId === articleId ? { ai: { ...state.ai, status: 'error', error: message } } : state,
      )
      get().toast(`${t('ai.error')}: ${message}`, 'error')
    }
  },

  stopSummary: () => {
    aiAbort?.abort()
  },

  translateArticle: async (articleId, targetLanguage, mode = 'bilingual') => {
    const { settings } = get()
    const article = get().articles.find((candidate) => candidate.id === articleId)
    if (!article) return
    if (!settings.ai.baseUrl.trim() || !settings.ai.model.trim() || aiNeedsKey(settings.ai)) {
      get().toast(t('translate.needConfig'), 'error')
      get().setSettingsOpen(true)
      return
    }
    const fullHtml = article.extractedHtml ?? article.contentHtml
    const prepared = prepareArticleHtml(fullHtml)
    if (prepared.blocks.length === 0) {
      get().toast(t('translate.noBlocks'), 'error')
      return
    }

    translateAbort?.abort()
    translateAbort = new AbortController()
    const existing = article.translations?.[targetLanguage]
    const map: Record<string, string> = { ...(existing?.blocks ?? {}) }
    const total = prepared.blocks.length + 1
    set({
      translate: {
        articleId,
        targetLanguage,
        mode,
        status: 'running',
        doneBlocks: Object.keys(map).length,
        totalBlocks: total,
      },
    })

    const allBlocks = [{ index: -1, text: article.title }, ...prepared.blocks]
    const batches = chunkBy(
      allBlocks.filter((block) => !map[String(block.index)]),
      TRANSLATE_BATCH_BLOCKS,
    ).flatMap((batch) => {
      const groups: typeof batch[] = []
      let current: typeof batch = []
      let chars = 0
      for (const block of batch) {
        if (chars + block.text.length > TRANSLATE_BATCH_CHARS && current.length > 0) {
          groups.push(current)
          current = []
          chars = 0
        }
        current.push(block)
        chars += block.text.length
      }
      if (current.length > 0) groups.push(current)
      return groups
    })

    const persist = async (): Promise<void> => {
      const translation: ArticleTranslation = {
        blocks: map,
        model: settings.ai.model,
        targetLanguage,
        createdAt: Date.now(),
      }
      const latest = get().articles.find((candidate) => candidate.id === articleId)
      await (await getRepository()).updateArticle(articleId, {
        translations: { ...(latest?.translations ?? {}), [targetLanguage]: translation },
      })
      set((state) => ({
        articles: state.articles.map((candidate) =>
          candidate.id === articleId
            ? { ...candidate, translations: { ...(candidate.translations ?? {}), [targetLanguage]: translation } }
            : candidate,
        ),
      }))
    }

    try {
      for (const batch of batches) {
        let buffer = ''
        await api.translateStream(
          { blocks: batch, targetLanguage, title: article.title },
          {
            apiBase: settings.apiBase,
            ai: settings.ai,
            proxy: proxyForAi(settings),
            signal: translateAbort.signal,
            onDelta: (chunk) => {
              buffer += chunk.replace(/\r/g, '')
              const lines = buffer.split('\n')
              buffer = lines.pop() ?? ''
              let changed = false
              for (const line of lines) {
                const parsed = parseTranslationLine(line)
                if (!parsed) continue
                map[String(parsed.index)] = parsed.text
                changed = true
              }
              if (!changed) return
              const latest = get().articles.find((candidate) => candidate.id === articleId)
              const translation: ArticleTranslation = {
                blocks: { ...map },
                model: settings.ai.model,
                targetLanguage,
                createdAt: Date.now(),
              }
              set((state) => ({
                translate: {
                  ...state.translate,
                  doneBlocks: Object.keys(map).length,
                  status: 'running',
                },
                articles: state.articles.map((candidate) =>
                  candidate.id === articleId
                    ? {
                        ...candidate,
                        translations: { ...(latest?.translations ?? {}), [targetLanguage]: translation },
                      }
                    : candidate,
                ),
              }))
            },
          },
        )
        const lastLine = parseTranslationLine(buffer)
        if (lastLine) map[String(lastLine.index)] = lastLine.text
        await persist()
      }

      set((state) => ({
        translate: { ...state.translate, status: 'done', doneBlocks: Object.keys(map).length },
      }))
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        set((state) => ({ translate: { ...state.translate, status: 'idle' } }))
        return
      }
      const message = error instanceof ApiError ? error.message : (error as Error).message
      set((state) => ({ translate: { ...state.translate, status: 'error', error: message } }))
      get().toast(`${t('translate.error')}: ${message}`, 'error')
    }
  },

  clearTranslation: async (articleId, targetLanguage) => {
    const article = get().articles.find((candidate) => candidate.id === articleId)
    if (!article?.translations) return
    const translations = { ...article.translations }
    delete translations[targetLanguage]
    await (await getRepository()).updateArticle(articleId, { translations })
    set((state) => ({
      articles: state.articles.map((candidate) =>
        candidate.id === articleId ? { ...candidate, translations } : candidate,
      ),
      translate: { ...state.translate, status: 'idle', doneBlocks: 0, totalBlocks: 0 },
    }))
  },

  stopTranslation: () => {
    translateAbort?.abort()
  },

  setTranslateMode: (mode) => set((state) => ({ translate: { ...state.translate, mode } })),
}))

/* -------------------------------------------------------------------------- */
/* Refresh internals                                                          */
/* -------------------------------------------------------------------------- */

async function refreshOne(
  feed: Feed,
  settings: Settings,
): Promise<{ feed: Feed; articles: Article[]; newCount: number; removed: string[] } | null> {
  const proxy = proxyForFeed(settings, feed)
  const result = await api.fetchFeed(feed.url, settings.apiBase, {
    ...(feed.etag ? { etag: feed.etag } : {}),
    ...(feed.lastModified ? { lastModified: feed.lastModified } : {}),
    ...(proxy ? { proxy } : {}),
  })

  const repository = await getRepository()

  if (result.notModified) {
    const updated: Feed = {
      ...feed,
      lastFetchedAt: Date.now(),
      lastError: undefined,
      ...(result.etag ? { etag: result.etag } : {}),
      ...(result.lastModified ? { lastModified: result.lastModified } : {}),
    }
    await repository.putFeed(updated)
    return { feed: updated, articles: [], newCount: 0, removed: [] }
  }
  if (!result.feed) throw new Error(result.error ?? '无法解析订阅源')

  const parsed = result.feed
  const mapped = mapItems(feed.id, parsed.items)
  const existingRows = await repository.articlesByFeed(feed.id)
  const byId = new Map(existingRows.map((article) => [article.id, article]))
  const byLink = new Map(existingRows.map((article) => [normalizeLink(article.link), article]))
  const seenLinks = new Set<string>()
  let newCount = 0

  const merged: Article[] = []
  for (const article of mapped) {
    const key = normalizeLink(article.link)
    const existing = byId.get(article.id) ?? (key ? byLink.get(key) : undefined)
    if (key) {
      if (seenLinks.has(key)) continue
      seenLinks.add(key)
    }
    if (existing) {
      merged.push({
        ...article,
        id: existing.id,
        read: existing.read,
        starred: existing.starred,
        savedAt: existing.savedAt,
        ...(existing.aiSummary ? { aiSummary: existing.aiSummary } : {}),
        ...(existing.translations ? { translations: existing.translations } : {}),
        ...(existing.extractedHtml ? { extractedHtml: existing.extractedHtml } : {}),
        ...(existing.extractedAt ? { extractedAt: existing.extractedAt } : {}),
      })
    } else {
      merged.push(article)
      newCount += 1
    }
  }

  if (merged.length > 0) await repository.putArticles(merged)
  const updatedFeed: Feed = {
    ...feed,
    title: feed.titleLocked ? feed.title : parsed.title || feed.title,
    ...(parsed.iconUrl ? { iconUrl: parsed.iconUrl } : {}),
    ...(parsed.siteUrl ? { siteUrl: parsed.siteUrl } : {}),
    ...(parsed.description ? { description: parsed.description } : {}),
    format: parsed.format,
    lastFetchedAt: Date.now(),
    lastError: undefined,
    ...(result.etag ? { etag: result.etag } : {}),
    ...(result.lastModified ? { lastModified: result.lastModified } : {}),
  }
  await repository.putFeed(updatedFeed)
  const removed = await pruneFeed(feed.id)
  return { feed: updatedFeed, articles: merged, newCount, removed }
}

export const AI_PROVIDERS = AI_PRESETS
export { readingMinutes }
