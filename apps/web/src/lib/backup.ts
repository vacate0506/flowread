import type { Feed, Folder, Settings } from '../types'
import { DEFAULT_SETTINGS, DEFAULT_AI } from '../types'
import type { AiProvider } from '@flowread/shared'

export const BACKUP_APP = 'flowread'
export const BACKUP_VERSION = 1

export interface FlowReadBackup {
  app: typeof BACKUP_APP
  version: number
  exportedAt: string
  settings: Settings
  folders: Folder[]
  feeds: Feed[]
}

export interface BackupInput {
  settings: Settings
  folders: Folder[]
  feeds: Feed[]
  /** Include the AI API key in clear text (the file is a secret then). */
  includeKey: boolean
}

const FEED_FORMATS = new Set(['rss', 'atom', 'json'])
const PROVIDERS = new Set(['deepseek', 'openai', 'siliconflow', 'ollama', 'custom'])

/** Build a portable JSON backup of settings, folders and subscriptions. */
export function buildBackup({ settings, folders, feeds, includeKey }: BackupInput): FlowReadBackup {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      ...settings,
      ai: { ...settings.ai, apiKey: includeKey ? settings.ai.apiKey : '' },
    },
    folders: folders.map((folder) => ({ id: folder.id, name: folder.name, createdAt: folder.createdAt })),
    // ETag/lastError are runtime cache details; keep the portable fields only.
    feeds: feeds.map((feed) => ({
      id: feed.id,
      url: feed.url,
      title: feed.title,
      ...(feed.siteUrl ? { siteUrl: feed.siteUrl } : {}),
      ...(feed.iconUrl ? { iconUrl: feed.iconUrl } : {}),
      ...(feed.description ? { description: feed.description } : {}),
      format: feed.format,
      ...(feed.folderId ? { folderId: feed.folderId } : {}),
      createdAt: feed.createdAt,
      ...(feed.lastFetchedAt ? { lastFetchedAt: feed.lastFetchedAt } : {}),
      ...(feed.sortIndex != null ? { sortIndex: feed.sortIndex } : {}),
      ...(feed.titleLocked ? { titleLocked: true } : {}),
      ...(feed.useProxy ? { useProxy: true } : {}),
    })),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sanitizeSettings(value: unknown): Partial<Settings> | undefined {
  if (!isRecord(value)) return undefined
  const output: Partial<Settings> = {}
  if (value.theme === 'light' || value.theme === 'dark' || value.theme === 'system') output.theme = value.theme
  if (value.locale === 'zh' || value.locale === 'en') output.locale = value.locale
  if (typeof value.apiBase === 'string') output.apiBase = value.apiBase
  if (value.view === 'card' || value.view === 'compact') output.view = value.view
  if (typeof value.fontSize === 'number' && value.fontSize >= 12 && value.fontSize <= 32) {
    output.fontSize = value.fontSize
  }
  if (typeof value.unreadOnly === 'boolean') output.unreadOnly = value.unreadOnly
  if (typeof value.markReadOnOpen === 'boolean') output.markReadOnOpen = value.markReadOnOpen
  if (typeof value.autoExtract === 'boolean') output.autoExtract = value.autoExtract
  if (typeof value.refreshMinutes === 'number' && value.refreshMinutes >= 0) {
    output.refreshMinutes = value.refreshMinutes
  }
  if (typeof value.aiLanguage === 'string') output.aiLanguage = value.aiLanguage
  if (typeof value.targetLanguage === 'string') output.targetLanguage = value.targetLanguage
  if (typeof value.onboardingDone === 'boolean') output.onboardingDone = value.onboardingDone
  if (isRecord(value.proxy)) {
    output.proxy = {
      enabled: value.proxy.enabled === true,
      mode: value.proxy.mode === 'selected' ? 'selected' : 'all',
      url: asString(value.proxy.url, ''),
    }
  }
  if (typeof value.sidebarHidden === 'boolean') output.sidebarHidden = value.sidebarHidden
  if (typeof value.listHidden === 'boolean') output.listHidden = value.listHidden

  if (isRecord(value.ai)) {
    const ai = value.ai
    const provider = asString(ai.provider, DEFAULT_AI.provider)
    output.ai = {
      provider: (PROVIDERS.has(provider) ? provider : 'custom') as AiProvider,
      baseUrl: asString(ai.baseUrl, DEFAULT_AI.baseUrl),
      apiKey: asString(ai.apiKey, ''),
      model: asString(ai.model, DEFAULT_AI.model),
      ...(typeof ai.temperature === 'number' ? { temperature: ai.temperature } : {}),
    }
  }
  return output
}

function sanitizeFeed(value: unknown, now: number): Feed | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const url = asString(value.url)
  const title = asString(value.title)
  if (!id || !url) return null
  const format = asString(value.format, 'rss')
  return {
    id,
    url,
    title: title || url,
    ...(typeof value.siteUrl === 'string' ? { siteUrl: value.siteUrl } : {}),
    ...(typeof value.iconUrl === 'string' ? { iconUrl: value.iconUrl } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    format: (FEED_FORMATS.has(format) ? format : 'rss') as Feed['format'],
    ...(typeof value.folderId === 'string' ? { folderId: value.folderId } : {}),
    createdAt: asNumber(value.createdAt, now),
    ...(typeof value.lastFetchedAt === 'number' ? { lastFetchedAt: value.lastFetchedAt } : {}),
    ...(typeof value.sortIndex === 'number' ? { sortIndex: value.sortIndex } : {}),
    ...(value.titleLocked === true ? { titleLocked: true } : {}),
    ...(value.useProxy === true ? { useProxy: true } : {}),
  }
}

function sanitizeFolder(value: unknown, now: number): Folder | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const name = asString(value.name)
  if (!id || !name) return null
  return { id, name, createdAt: asNumber(value.createdAt, now) }
}

/** Parse and validate a backup file. Throws a human-readable error on bad input. */
export function parseBackup(text: string): FlowReadBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('备份文件不是有效的 JSON')
  }
  if (!isRecord(raw) || raw.app !== BACKUP_APP) throw new Error('这不是 FlowRead 的配置文件')
  const version = asNumber(raw.version, 0)
  if (version < 1 || version > BACKUP_VERSION) throw new Error(`不支持的备份版本：${version}`)
  if (!Array.isArray(raw.folders) || !Array.isArray(raw.feeds)) throw new Error('备份缺少订阅或分组数据')

  const now = Date.now()
  const folders = raw.folders.map((folder) => sanitizeFolder(folder, now)).filter((folder): folder is Folder => Boolean(folder))
  const feeds = raw.feeds.map((feed) => sanitizeFeed(feed, now)).filter((feed): feed is Feed => Boolean(feed))
  if (feeds.length === 0) throw new Error('备份里没有可用的订阅')

  const settings = sanitizeSettings(raw.settings)
  return {
    app: BACKUP_APP,
    version,
    exportedAt: asString(raw.exportedAt, new Date(now).toISOString()),
    settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) },
    folders,
    feeds,
  }
}
