import type { Article, Feed } from '../types'
import { dateGroupOf, type DateGroup } from './utils'

export interface ArticleFilter {
  feedId?: string
  starred?: boolean
  query?: string
  unreadOnly?: boolean
  feeds?: Feed[]
}

function normalize(value: string): string {
  return value.toLowerCase()
}

export function filterArticles(articles: Article[], filter: ArticleFilter): Article[] {
  const query = filter.query?.trim().toLowerCase() ?? ''
  const feedTitle = new Map((filter.feeds ?? []).map((feed) => [feed.id, feed.title]))
  return articles.filter((article) => {
    if (filter.feedId && article.feedId !== filter.feedId) return false
    if (filter.starred && !article.starred) return false
    if (filter.unreadOnly && article.read) return false
    if (!query) return true
    const haystack = [
      article.title,
      article.summary,
      article.author ?? '',
      feedTitle.get(article.feedId) ?? '',
      article.categories.join(' '),
      article.aiSummary?.text ?? '',
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(normalize(query))
  })
}

export function unreadCount(articles: Article[], feedId?: string): number {
  let count = 0
  for (const article of articles) {
    if (article.read) continue
    if (feedId && article.feedId !== feedId) continue
    count += 1
  }
  return count
}

export function unreadByFeed(articles: Article[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const article of articles) {
    if (article.read) continue
    map.set(article.feedId, (map.get(article.feedId) ?? 0) + 1)
  }
  return map
}

export function articleCountByFeed(articles: Article[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const article of articles) map.set(article.feedId, (map.get(article.feedId) ?? 0) + 1)
  return map
}

export interface ArticleGroup {
  key: DateGroup
  articles: Article[]
}

export function groupArticles(articles: Article[]): ArticleGroup[] {
  const groups: ArticleGroup[] = []
  const index = new Map<DateGroup, ArticleGroup>()
  for (const article of articles) {
    const key = dateGroupOf(article.publishedAt ?? article.savedAt)
    let group = index.get(key)
    if (!group) {
      group = { key, articles: [] }
      index.set(key, group)
      groups.push(group)
    }
    group.articles.push(article)
  }
  return groups
}

export const GROUP_ORDER: DateGroup[] = ['today', 'yesterday', 'week', 'earlier', 'undated']
