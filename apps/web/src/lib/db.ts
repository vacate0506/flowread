import Dexie, { type Table } from 'dexie'
import type { Article, Feed, Folder } from '../types'

export interface SettingRow {
  key: string
  value: unknown
}

/** Local-first storage: everything the reader needs lives in IndexedDB. */
class FlowReadDatabase extends Dexie {
  feeds!: Table<Feed, string>
  folders!: Table<Folder, string>
  articles!: Table<Article, string>
  settings!: Table<SettingRow, string>

  constructor() {
    super('flowread')
    this.version(1).stores({
      feeds: 'id, url, folderId, createdAt, lastFetchedAt',
      folders: 'id, name, createdAt',
      articles: 'id, feedId, publishedAt, savedAt',
      settings: 'key',
    })
  }
}

export const db = new FlowReadDatabase()
export const SETTINGS_KEY = 'app'

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.feeds, db.folders, db.articles, async () => {
    await Promise.all([db.feeds.clear(), db.folders.clear(), db.articles.clear()])
  })
}
