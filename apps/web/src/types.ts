import type { AiConfig, FeedFormat, SummaryMode } from '@flowread/shared'

export type Locale = 'zh' | 'en'
export type ThemeMode = 'light' | 'dark' | 'system'
export type ViewMode = 'card' | 'compact'
export type TranslationMode = 'bilingual' | 'translated'
export type ProxyMode = 'all' | 'selected'

export interface ProxySettings {
  enabled: boolean
  mode: ProxyMode
  /** HTTP/HTTPS proxy URL, e.g. http://127.0.0.1:7890 */
  url: string
}

export interface Folder {
  id: string
  name: string
  createdAt: number
}

export interface Feed {
  id: string
  url: string
  title: string
  siteUrl?: string
  iconUrl?: string
  description?: string
  format: FeedFormat
  folderId?: string
  createdAt: number
  lastFetchedAt?: number
  lastError?: string
  etag?: string
  lastModified?: string
  /** Manual ordering inside the sidebar (ascending). */
  sortIndex?: number
  /** Set when the user renamed the feed, so refresh keeps the custom title. */
  titleLocked?: boolean
  /** Route this feed through the configured proxy when mode is "selected". */
  useProxy?: boolean
}

export interface AiSummary {
  text: string
  mode: SummaryMode
  model: string
  language: string
  createdAt: number
}

export interface ArticleTranslation {
  blocks: Record<string, string>
  model: string
  targetLanguage: string
  createdAt: number
}

export interface Article {
  id: string
  feedId: string
  guid: string
  title: string
  link: string
  summary: string
  contentHtml: string
  author?: string
  publishedAt?: number
  imageUrl?: string
  categories: string[]
  audioUrl?: string
  read: boolean
  starred: boolean
  savedAt: number
  fetchedAt: number
  extractedHtml?: string
  extractedAt?: number
  aiSummary?: AiSummary
  translations?: Record<string, ArticleTranslation>
}

export interface Settings {
  theme: ThemeMode
  locale: Locale
  apiBase: string
  ai: AiConfig
  aiLanguage: string
  targetLanguage: string
  fontSize: number
  view: ViewMode
  unreadOnly: boolean
  markReadOnOpen: boolean
  autoExtract: boolean
  refreshMinutes: number
  onboardingDone: boolean
  proxy: ProxySettings
  /** Desktop layout: hide the subscription sidebar / article list. */
  sidebarHidden: boolean
  listHidden: boolean
}

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
}

export interface RefreshProgress {
  running: boolean
  done: number
  total: number
  current?: string
  failed: number
  newArticles: number
}

export interface AiState {
  articleId?: string
  status: 'idle' | 'running' | 'done' | 'error'
  mode: SummaryMode
  text: string
  error?: string
  model?: string
}

export interface TranslateState {
  articleId?: string
  targetLanguage: string
  mode: TranslationMode
  status: 'idle' | 'running' | 'done' | 'error'
  doneBlocks: number
  totalBlocks: number
  error?: string
}

export interface AiSummaryRequest {
  title: string
  content: string
  mode: SummaryMode
  language: string
  url?: string
}

export const DEFAULT_AI: AiConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.3,
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  locale: 'zh',
  apiBase: '',
  ai: DEFAULT_AI,
  aiLanguage: 'auto',
  targetLanguage: 'zh-CN',
  fontSize: 17,
  view: 'card',
  unreadOnly: false,
  markReadOnOpen: true,
  autoExtract: true,
  refreshMinutes: 30,
  onboardingDone: false,
  proxy: {
    enabled: false,
    mode: 'all',
    url: '',
  },
  sidebarHidden: false,
  listHidden: false,
}
