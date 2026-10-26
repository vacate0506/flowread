import type { Feed } from '../types'

export const FEED_ORDER_STEP = 100

/** Feeds with an explicit sortIndex win; the rest fall back to title order. */
export function sortFeeds(feeds: Feed[]): Feed[] {
  return [...feeds].sort((a, b) => {
    const left = a.sortIndex
    const right = b.sortIndex
    if (left != null && right != null && left !== right) return left - right
    if (left != null && right == null) return -1
    if (left == null && right != null) return 1
    return a.title.localeCompare(b.title)
  })
}

export function normalizeFeedOrder(feeds: Feed[]): Feed[] {
  return sortFeeds(feeds).map((feed, index) => ({ ...feed, sortIndex: index * FEED_ORDER_STEP }))
}

export function nextSortIndex(feeds: Feed[]): number {
  const highest = feeds.reduce((max, feed) => Math.max(max, feed.sortIndex ?? 0), 0)
  return highest + FEED_ORDER_STEP
}

export interface FeedDropTarget {
  /** Insert before this feed; takes precedence over afterFeedId. */
  beforeFeedId?: string
  /** Insert after this feed. */
  afterFeedId?: string
  /** Move the feed into this folder (null/undefined = keep current). */
  folderId?: string | null
}

/**
 * Move a feed in the global order and/or into another folder. Returns a new
 * array with normalised `sortIndex` values; every feed gets a stable order so
 * the sidebar keeps the user's arrangement across reloads.
 */
export function moveFeedTo(feeds: Feed[], feedId: string, target: FeedDropTarget): Feed[] {
  const ordered = sortFeeds(feeds)
  const dragged = ordered.find((feed) => feed.id === feedId)
  if (!dragged) return ordered

  const without = ordered.filter((feed) => feed.id !== feedId)
  const moved: Feed = { ...dragged }

  if (target.folderId !== undefined) {
    if (target.folderId) moved.folderId = target.folderId
    else delete moved.folderId
  }

  let insertAt = without.length
  const anchorId = target.beforeFeedId ?? target.afterFeedId
  if (anchorId) {
    const anchorIndex = without.findIndex((feed) => feed.id === anchorId)
    if (anchorIndex >= 0) insertAt = target.beforeFeedId ? anchorIndex : anchorIndex + 1
  } else if (target.folderId) {
    // Dropping on a folder header appends to the end of that folder.
    let lastIndex = -1
    without.forEach((feed, index) => {
      if (feed.folderId === target.folderId) lastIndex = index
    })
    if (lastIndex >= 0) insertAt = lastIndex + 1
  }

  without.splice(insertAt, 0, moved)
  return without.map((feed, index) => ({ ...feed, sortIndex: index * FEED_ORDER_STEP }))
}
