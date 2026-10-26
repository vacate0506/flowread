import { db, clearAllData } from './db'
import type { LocalRepository } from './repository'
import { SETTINGS_KEY } from './repository'
import type { Article, Feed, Folder } from '../types'

/** IndexedDB implementation used by the web/PWA build. */
export class DexieRepository implements LocalRepository {
  async init(): Promise<void> {
    await db.open()
  }

  async loadAll(): Promise<{ feeds: Feed[]; folders: Folder[]; articles: Article[]; settings: unknown }> {
    const [feeds, folders, articles, settings] = await Promise.all([
      db.feeds.toArray(),
      db.folders.toArray(),
      db.articles.toArray(),
      db.settings.get(SETTINGS_KEY),
    ])
    return { feeds, folders, articles, settings: settings?.value ?? null }
  }

  async putFeed(feed: Feed): Promise<void> {
    await db.feeds.put(feed)
  }

  async putFeeds(feeds: Feed[]): Promise<void> {
    if (feeds.length > 0) await db.feeds.bulkPut(feeds)
  }

  async updateFeed(id: string, patch: Partial<Feed>): Promise<void> {
    await db.feeds.update(id, patch)
  }

  async deleteFeed(id: string): Promise<void> {
    await db.transaction('rw', db.feeds, db.articles, async () => {
      await db.feeds.delete(id)
      await db.articles.where('feedId').equals(id).delete()
    })
  }

  async putFolder(folder: Folder): Promise<void> {
    await db.folders.put(folder)
  }

  async putFolders(folders: Folder[]): Promise<void> {
    if (folders.length > 0) await db.folders.bulkPut(folders)
  }

  async updateFolder(id: string, patch: Partial<Folder>): Promise<void> {
    await db.folders.update(id, patch)
  }

  async deleteFolder(id: string): Promise<void> {
    await db.folders.delete(id)
  }

  async putArticles(articles: Article[]): Promise<void> {
    if (articles.length > 0) await db.articles.bulkPut(articles)
  }

  async deleteArticles(ids: string[]): Promise<void> {
    if (ids.length > 0) await db.articles.bulkDelete(ids)
  }

  async deleteArticlesByFeed(feedId: string): Promise<void> {
    await db.articles.where('feedId').equals(feedId).delete()
  }

  async articlesByFeed(feedId: string): Promise<Article[]> {
    return db.articles.where('feedId').equals(feedId).toArray()
  }

  async updateArticle(id: string, patch: Partial<Article>): Promise<void> {
    await db.articles.update(id, patch)
  }

  async updateArticles(ids: string[], patch: Partial<Article>): Promise<void> {
    if (ids.length > 0) await db.articles.where('id').anyOf(ids).modify(patch)
  }

  async getSettings(): Promise<unknown> {
    const row = await db.settings.get(SETTINGS_KEY)
    return row?.value ?? null
  }

  async putSettings(value: unknown): Promise<void> {
    await db.settings.put({ key: SETTINGS_KEY, value })
  }

  async clearAll(): Promise<void> {
    await clearAllData()
  }
}
