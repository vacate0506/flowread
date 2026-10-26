import { describe, expect, it } from 'vitest'
import { normalizeProxyUrl, proxyForAi, proxyForFeed } from '../proxy'
import type { Settings } from '../../types'
import { DEFAULT_SETTINGS } from '../../types'

function settings(proxy: Partial<Settings['proxy']>): Settings {
  return { ...DEFAULT_SETTINGS, proxy: { ...DEFAULT_SETTINGS.proxy, ...proxy } }
}

describe('proxy helpers', () => {
  it('normalises valid proxy URLs', () => {
    expect(normalizeProxyUrl('http://127.0.0.1:7890')).toBe('http://127.0.0.1:7890')
    expect(normalizeProxyUrl(' https://proxy.example.com:443/ ')).toBe('https://proxy.example.com')
    expect(normalizeProxyUrl('socks5://127.0.0.1:1080')).toBeUndefined()
    expect(normalizeProxyUrl('not a url')).toBeUndefined()
    expect(normalizeProxyUrl('')).toBeUndefined()
  })

  it('routes all feeds in all mode', () => {
    const config = settings({ enabled: true, mode: 'all', url: 'http://127.0.0.1:7890' })
    expect(proxyForFeed(config)).toBe('http://127.0.0.1:7890')
    expect(proxyForFeed(config, { useProxy: false })).toBe('http://127.0.0.1:7890')
    expect(proxyForAi(config)).toBe('http://127.0.0.1:7890')
  })

  it('routes only marked feeds in selected mode', () => {
    const config = settings({ enabled: true, mode: 'selected', url: 'http://127.0.0.1:7890' })
    expect(proxyForFeed(config, { useProxy: true })).toBe('http://127.0.0.1:7890')
    expect(proxyForFeed(config, { useProxy: false })).toBeUndefined()
    expect(proxyForFeed(config)).toBeUndefined()
    expect(proxyForAi(config)).toBeUndefined()
  })

  it('ignores disabled or invalid proxy settings', () => {
    expect(proxyForFeed(settings({ enabled: false, url: 'http://127.0.0.1:7890' }))).toBeUndefined()
    expect(proxyForFeed(settings({ enabled: true, url: 'nope' }))).toBeUndefined()
  })
})
