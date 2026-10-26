import type { Settings } from '../types'

/** Validate and normalise a user supplied HTTP(S) proxy URL. */
export function normalizeProxyUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (!url.hostname) return undefined
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

/** Proxy for a feed fetch: all feeds, or only feeds explicitly marked. */
export function proxyForFeed(settings: Pick<Settings, 'proxy'>, feed?: { useProxy?: boolean }): string | undefined {
  if (!settings.proxy.enabled) return undefined
  const url = normalizeProxyUrl(settings.proxy.url)
  if (!url) return undefined
  if (settings.proxy.mode === 'all') return url
  return feed?.useProxy ? url : undefined
}

/**
 * AI requests are not tied to a feed. They use the proxy only in "all" mode;
 * in "selected" mode they connect directly.
 */
export function proxyForAi(settings: Pick<Settings, 'proxy'>): string | undefined {
  if (!settings.proxy.enabled || settings.proxy.mode !== 'all') return undefined
  return normalizeProxyUrl(settings.proxy.url)
}
