import type { LocalRepository } from './repository'
import { SETTINGS_KEY } from './repository'
import type { Article, Feed, Folder } from '../types'

interface SqlDatabase {
  execute(sql: string, params?: unknown[]): Promise<unknown>
  select<T>(sql: string, params?: unknown[]): Promise<T>
}

let database: SqlDatabase | null = null

async function getDb(): Promise<SqlDatabase> {
  if (database) return database
  const module = await import('@tauri-apps/plugin-sql')
  const Database = module.default
  const instance = await Database.load('sqlite:flowread.db')
  database = instance as unknown as SqlDatabase
  return database
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

/** SQLite implementation used by the Tauri desktop build (file: flowread.db). */
export class SqliteRepository implements LocalRepository {
  async init(): Promise<void> {
    const db = await getDb()
    await db.execute(`CREATE TABLE IF NOT EXISTS feeds (
      id TEXT PRIMARY KEY NOT NULL,
      folder_id TEXT,
      sort_index INTEGER,
      data TEXT NOT NULL
    )`)
    await db.execute(`CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY NOT NULL,
      data TEXT NOT NULL
    )`)
    await db.execute(`CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY NOT NULL,
      feed_id TEXT NOT NULL,
      published_at INTEGER,
      data TEXT NOT NULL
    )`)
    await db.execute('CREATE INDEX IF NOT EXISTS idx_articles_feed ON articles(feed_id)')
    await db.execute('CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at)')
    await db.execute(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    )`)
  }

  async loadAll(): Promise<{ feeds: Feed[]; folders: Folder[]; articles: Article[]; settings: unknown }> {
    const db = await getDb()
    const [feeds, folders, articles, settings] = await Promise.all([
      db.select<{ data: string }[]>('SELECT data FROM feeds ORDER BY sort_index IS NULL, sort_index'),
      db.select<{ data: string }[]>('SELECT data FROM folders'),
      db.select<{ data: string }[]>('SELECT data FROM articles ORDER BY published_at DESC'),
      db.select<{ value: string }[]>('SELECT value FROM settings WHERE key = ?', [SETTINGS_KEY]),
    ])
    return {
      feeds: feeds.map((row) => parseJson<Feed>(row.data)).filter((feed): feed is Feed => Boolean(feed)),
      folders: folders.map((row) => parseJson<Folder>(row.data)).filter((folder): folder is Folder => Boolean(folder)),
      articles: articles.map((row) => parseJson<Article>(row.data)).filter((article): article is Article => Boolean(article)),
      settings: settings[0] ? parseJson<unknown>(settings[0].value) : null,
    }
  }

  async putFeed(feed: Feed): Promise<void> {
    await this.putFeeds([feed])
  }

  async putFeeds(feeds: Feed[]): Promise<void> {
    if (feeds.length === 0) return
    const db = await getDb()
    for (const group of chunk(feeds, 50)) {
      const placeholders = group.map(() => '(?, ?, ?, ?)').join(', ')
      const params: unknown[] = []
      for (const feed of group) {
        params.push(feed.id, feed.folderId ?? null, feed.sortIndex ?? null, JSON.stringify(feed))
      }
      await db.execute(
        `INSERT OR REPLACE INTO feeds (id, folder_id, sort_index, data) VALUES ${placeholders}`,
        params,
      )
    }
  }

  async updateFeed(id: string, patch: Partial<Feed>): Promise<void> {
    const db = await getDb()
    const rows = await db.select<{ data: string }[]>('SELECT data FROM feeds WHERE id = ?', [id])
    const current = rows[0] ? parseJson<Feed>(rows[0].data) : null
    if (!current) return
    const next: Feed = { ...current, ...patch }
    if (patch.folderId === undefined && 'folderId' in patch) delete next.folderId
    await this.putFeed(next)
  }

  async deleteFeed(id: string): Promise<void> {
    const db = await getDb()
    await db.execute('DELETE FROM feeds WHERE id = ?', [id])
    await db.execute('DELETE FROM articles WHERE feed_id = ?', [id])
  }

  async putFolder(folder: Folder): Promise<void> {
    await this.putFolders([folder])
  }

  async putFolders(folders: Folder[]): Promise<void> {
    if (folders.length === 0) return
    const db = await getDb()
    for (const group of chunk(folders, 50)) {
      const placeholders = group.map(() => '(?, ?)').join(', ')
      const params: unknown[] = []
      for (const folder of group) params.push(folder.id, JSON.stringify(folder))
      await db.execute(`INSERT OR REPLACE INTO folders (id, data) VALUES ${placeholders}`, params)
    }
  }

  async updateFolder(id: string, patch: Partial<Folder>): Promise<void> {
    const db = await getDb()
    const rows = await db.select<{ data: string }[]>('SELECT data FROM folders WHERE id = ?', [id])
    const current = rows[0] ? parseJson<Folder>(rows[0].data) : null
    if (!current) return
    await this.putFolder({ ...current, ...patch })
  }

  async deleteFolder(id: string): Promise<void> {
    const db = await getDb()
    await db.execute('DELETE FROM folders WHERE id = ?', [id])
  }

  async putArticles(articles: Article[]): Promise<void> {
    if (articles.length === 0) return
    const db = await getDb()
    for (const group of chunk(articles, 40)) {
      const placeholders = group.map(() => '(?, ?, ?, ?)').join(', ')
      const params: unknown[] = []
      for (const article of group) {
        params.push(
          article.id,
          article.feedId,
          article.publishedAt ?? article.savedAt,
          JSON.stringify(article),
        )
      }
      await db.execute(
        `INSERT OR REPLACE INTO articles (id, feed_id, published_at, data) VALUES ${placeholders}`,
        params,
      )
    }
  }

  async deleteArticles(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const db = await getDb()
    for (const group of chunk(ids, 150)) {
      const placeholders = group.map(() => '?').join(', ')
      await db.execute(`DELETE FROM articles WHERE id IN (${placeholders})`, group)
    }
  }

  async deleteArticlesByFeed(feedId: string): Promise<void> {
    const db = await getDb()
    await db.execute('DELETE FROM articles WHERE feed_id = ?', [feedId])
  }

  async articlesByFeed(feedId: string): Promise<Article[]> {
    const db = await getDb()
    const rows = await db.select<{ data: string }[]>('SELECT data FROM articles WHERE feed_id = ?', [feedId])
    return rows.map((row) => parseJson<Article>(row.data)).filter((article): article is Article => Boolean(article))
  }

  async updateArticle(id: string, patch: Partial<Article>): Promise<void> {
    const db = await getDb()
    const rows = await db.select<{ data: string }[]>('SELECT data FROM articles WHERE id = ?', [id])
    const current = rows[0] ? parseJson<Article>(rows[0].data) : null
    if (!current) return
    await this.putArticles([{ ...current, ...patch }])
  }

  async updateArticles(ids: string[], patch: Partial<Article>): Promise<void> {
    if (ids.length === 0) return
    const db = await getDb()
    const updates: Article[] = []
    for (const group of chunk(ids, 120)) {
      const placeholders = group.map(() => '?').join(', ')
      const rows = await db.select<{ data: string }[]>(
        `SELECT data FROM articles WHERE id IN (${placeholders})`,
        group,
      )
      for (const row of rows) {
        const article = parseJson<Article>(row.data)
        if (article) updates.push({ ...article, ...patch })
      }
    }
    await this.putArticles(updates)
  }

  async getSettings(): Promise<unknown> {
    const db = await getDb()
    const rows = await db.select<{ value: string }[]>('SELECT value FROM settings WHERE key = ?', [SETTINGS_KEY])
    return rows[0] ? parseJson<unknown>(rows[0].value) : null
  }

  async putSettings(value: unknown): Promise<void> {
    const db = await getDb()
    await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
      SETTINGS_KEY,
      JSON.stringify(value),
    ])
  }

  async clearAll(): Promise<void> {
    const db = await getDb()
    await db.execute('DELETE FROM feeds')
    await db.execute('DELETE FROM folders')
    await db.execute('DELETE FROM articles')
  }
}
