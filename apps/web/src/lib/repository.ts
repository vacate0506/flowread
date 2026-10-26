import type { Article, Feed, Folder } from '../types'
import { isTauri } from './platform'

/** Storage contract shared by IndexedDB (web/PWA) and SQLite (Tauri desktop). */
export interface LocalRepository {
  init(): Promise<void>
  loadAll(): Promise<{ feeds: Feed[]; folders: Folder[]; articles: Article[]; settings: unknown }>
  putFeed(feed: Feed): Promise<void>
  putFeeds(feeds: Feed[]): Promise<void>
  updateFeed(id: string, patch: Partial<Feed>): Promise<void>
  deleteFeed(id: string): Promise<void>
  putFolder(folder: Folder): Promise<void>
  putFolders(folders: Folder[]): Promise<void>
  updateFolder(id: string, patch: Partial<Folder>): Promise<void>
  deleteFolder(id: string): Promise<void>
  putArticles(articles: Article[]): Promise<void>
  deleteArticles(ids: string[]): Promise<void>
  deleteArticlesByFeed(feedId: string): Promise<void>
  articlesByFeed(feedId: string): Promise<Article[]>
  updateArticle(id: string, patch: Partial<Article>): Promise<void>
  updateArticles(ids: string[], patch: Partial<Article>): Promise<void>
  getSettings(): Promise<unknown>
  putSettings(value: unknown): Promise<void>
  clearAll(): Promise<void>
}

export const SETTINGS_KEY = 'app'

let cached: Promise<LocalRepository> | null = null

/**
 * Tauri builds use SQLite via the Rust SQL plugin; the web/PWA build keeps
 * IndexedDB so it still works offline in a normal browser.
 */
export function getRepository(): Promise<LocalRepository> {
  if (!cached) {
    cached = (async () => {
      if (isTauri()) {
        const { SqliteRepository } = await import('./repository.sqlite')
        return new SqliteRepository()
      }
      const { DexieRepository } = await import('./repository.dexie')
      return new DexieRepository()
    })()
  }
  return cached
}
