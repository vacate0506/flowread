import { describe, expect, it } from 'vitest'
import { BACKUP_APP, BACKUP_VERSION, buildBackup, parseBackup } from '../backup'
import type { Feed, Folder, Settings } from '../../types'
import { DEFAULT_SETTINGS } from '../../types'

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  ai: { ...DEFAULT_SETTINGS.ai, apiKey: 'sk-secret', model: 'deepseek-chat' },
  fontSize: 19,
  theme: 'dark',
}

const folders: Folder[] = [{ id: 'f1', name: 'Tech', createdAt: 1 }]

const feeds: Feed[] = [
  {
    id: 'feed1',
    url: 'https://example.com/feed.xml',
    title: 'Example',
    format: 'rss',
    folderId: 'f1',
    createdAt: 1,
    sortIndex: 100,
    titleLocked: true,
    lastError: 'boom',
    etag: 'W/"1"',
  },
]

describe('buildBackup', () => {
  it('omits the API key by default', () => {
    const backup = buildBackup({ settings, folders, feeds, includeKey: false })
    expect(backup.app).toBe(BACKUP_APP)
    expect(backup.version).toBe(BACKUP_VERSION)
    expect(backup.settings.ai.apiKey).toBe('')
    expect(backup.feeds).toHaveLength(1)
    expect(backup.feeds[0]?.titleLocked).toBe(true)
    expect(backup.feeds[0]?.lastError).toBeUndefined()
    expect(backup.feeds[0]?.etag).toBeUndefined()
  })

  it('includes the API key when asked', () => {
    const backup = buildBackup({ settings, folders, feeds, includeKey: true })
    expect(backup.settings.ai.apiKey).toBe('sk-secret')
  })
})

describe('parseBackup', () => {
  it('round-trips a generated backup', () => {
    const json = JSON.stringify(buildBackup({ settings, folders, feeds, includeKey: true }))
    const parsed = parseBackup(json)
    expect(parsed.feeds[0]?.id).toBe('feed1')
    expect(parsed.feeds[0]?.folderId).toBe('f1')
    expect(parsed.folders[0]?.name).toBe('Tech')
    expect(parsed.settings.theme).toBe('dark')
    expect(parsed.settings.fontSize).toBe(19)
    expect(parsed.settings.ai.apiKey).toBe('sk-secret')
  })

  it('rejects unrelated JSON', () => {
    expect(() => parseBackup('{"hello":1}')).toThrow(/FlowRead/)
    expect(() => parseBackup('not json')).toThrow(/JSON/)
    expect(() => parseBackup(JSON.stringify({ app: BACKUP_APP, version: 99, feeds: [], folders: [] }))).toThrow(
      /版本/,
    )
  })

  it('requires at least one feed', () => {
    expect(() =>
      parseBackup(JSON.stringify({ app: BACKUP_APP, version: 1, feeds: [], folders: [] })),
    ).toThrow(/订阅/)
  })

  it('sanitises unknown formats and providers', () => {
    const parsed = parseBackup(
      JSON.stringify({
        app: BACKUP_APP,
        version: 1,
        feeds: [{ id: 'x', url: 'https://x.test/rss', title: 'X', format: 'nope' }],
        folders: [],
        settings: { ai: { provider: 'evil', baseUrl: 'https://x.test/v1', model: 'm', apiKey: 'k' } },
      }),
    )
    expect(parsed.feeds[0]?.format).toBe('rss')
    expect(parsed.settings.ai.provider).toBe('custom')
    expect(parsed.settings.fontSize).toBe(DEFAULT_SETTINGS.fontSize)
  })
})
