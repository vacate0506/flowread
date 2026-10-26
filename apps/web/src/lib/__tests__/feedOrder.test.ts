import { describe, expect, it } from 'vitest'
import { moveFeedTo, nextSortIndex, normalizeFeedOrder, sortFeeds } from '../feedOrder'
import type { Feed } from '../../types'

function feed(id: string, title: string, sortIndex?: number, folderId?: string): Feed {
  return {
    id,
    url: `https://example.com/${id}.xml`,
    title,
    format: 'rss',
    createdAt: 1,
    ...(sortIndex != null ? { sortIndex } : {}),
    ...(folderId ? { folderId } : {}),
  }
}

describe('sortFeeds', () => {
  it('prefers explicit sortIndex values', () => {
    const sorted = sortFeeds([feed('c', 'C', 300), feed('a', 'A', 100), feed('b', 'B', 200)])
    expect(sorted.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('falls back to title order for feeds without an index', () => {
    const sorted = sortFeeds([feed('z', 'Zeta'), feed('a', 'Alpha'), feed('m', 'Mid', 50)])
    expect(sorted.map((item) => item.id)).toEqual(['m', 'a', 'z'])
  })
})

describe('normalizeFeedOrder', () => {
  it('assigns a stable ascending index', () => {
    const normalized = normalizeFeedOrder([feed('b', 'B', 900), feed('a', 'A', 100)])
    expect(normalized.map((item) => [item.id, item.sortIndex])).toEqual([
      ['a', 0],
      ['b', 100],
    ])
  })

  it('nextSortIndex appends after the highest value', () => {
    expect(nextSortIndex([feed('a', 'A', 200), feed('b', 'B')])).toBe(300)
    expect(nextSortIndex([])).toBe(100)
  })
})

describe('moveFeedTo', () => {
  const base = [feed('a', 'A', 0, 'f1'), feed('b', 'B', 100, 'f1'), feed('c', 'C', 200, 'f2')]

  it('moves a feed before another feed', () => {
    const next = moveFeedTo(base, 'c', { beforeFeedId: 'a' })
    expect(next.map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(next.map((item) => item.sortIndex)).toEqual([0, 100, 200])
  })

  it('moves a feed after another feed', () => {
    const next = moveFeedTo(base, 'a', { afterFeedId: 'b' })
    expect(next.map((item) => item.id)).toEqual(['b', 'a', 'c'])
  })

  it('appends to the end when dropped on a folder header', () => {
    const next = moveFeedTo(base, 'c', { folderId: 'f1' })
    expect(next.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(next.find((item) => item.id === 'c')?.folderId).toBe('f1')
  })

  it('can move a feed back to uncategorized', () => {
    const next = moveFeedTo(base, 'a', { folderId: null })
    expect(next.find((item) => item.id === 'a')?.folderId).toBeUndefined()
  })

  it('keeps the folder when no folder target is provided', () => {
    const next = moveFeedTo(base, 'a', { afterFeedId: 'c' })
    expect(next.find((item) => item.id === 'a')?.folderId).toBe('f1')
    expect(next.map((item) => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('ignores unknown feeds', () => {
    expect(moveFeedTo(base, 'missing', { beforeFeedId: 'a' })).toHaveLength(3)
  })
})
