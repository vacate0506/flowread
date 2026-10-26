import { Hono } from 'hono'
import { discoverFeeds, discoverIcon, extractArticle } from '@flowread/shared/extract'
import {
  absolutizeUrl,
  looksLikeFeedPayload,
  normalizeUrl,
  parseFeedDocument,
  type ParsedFeed,
} from '@flowread/shared'
import { fetchBinary, fetchDocument, toArrayBuffer } from '../lib/fetcher'

interface FeedRouteOptions {
  allowPrivateNetwork: boolean
}

interface IconCacheEntry {
  body: Uint8Array
  contentType: string
  expiresAt: number
}

const ICON_TTL = 7 * 24 * 60 * 60 * 1000
const ICON_CACHE_LIMIT = 400
const iconCache = new Map<string, IconCacheEntry>()

function rememberIcon(key: string, entry: IconCacheEntry): void {
  if (iconCache.size >= ICON_CACHE_LIMIT) {
    const oldest = iconCache.keys().next().value
    if (oldest) iconCache.delete(oldest)
  }
  iconCache.set(key, entry)
}

function guessContentType(contentType: string, body: string): 'feed' | 'html' | 'unknown' {
  const head = body.replace(/^\uFEFF/, '').trimStart().slice(0, 200).toLowerCase()
  if (looksLikeFeedPayload(contentType, body) && !head.startsWith('<html') && !head.startsWith('<!doctype')) {
    return 'feed'
  }
  if (/html/i.test(contentType) || head.startsWith('<!doctype') || head.startsWith('<html')) return 'html'
  return 'unknown'
}

export function createFeedRoutes(options: FeedRouteOptions): Hono {
  const app = new Hono()

  app.post('/feed/fetch', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      url?: string
      etag?: string
      lastModified?: string
      autoDiscover?: boolean
      proxy?: string
    }
    const rawUrl = normalizeUrl(body.url ?? '')
    if (!rawUrl) return c.json({ error: '请提供订阅链接', code: 'missing_url' }, 400)

    const headers: Record<string, string> = {}
    if (body.etag) headers['if-none-match'] = body.etag
    if (body.lastModified) headers['if-modified-since'] = body.lastModified

    const first = await fetchDocument(rawUrl, {
      headers,
      allowPrivateNetwork: options.allowPrivateNetwork,
      proxy: body.proxy,
    })
    if (first.status === 304) {
      return c.json({
        notModified: true,
        ...(first.etag ? { etag: first.etag } : {}),
        ...(first.lastModified ? { lastModified: first.lastModified } : {}),
      })
    }

    const kind = guessContentType(first.contentType, first.body)
    let feed: ParsedFeed
    let resolvedUrl = first.url
    let discoveredFrom: string | undefined

    if (kind === 'feed' || body.autoDiscover === false) {
      feed = parseFeedDocument(first.body, first.url)
    } else {
      // The user pasted a website URL – look for a feed inside it.
      const discovery = discoverFeeds(first.body, first.url)
      const candidate = discovery.candidates[0]
      if (!candidate) {
        return c.json(
          {
            error: '这个页面里没有找到 RSS/Atom 订阅源，请直接填写订阅链接（通常以 .xml 或 /feed 结尾）。',
            code: 'no_feed_found',
          },
          422,
        )
      }
      const second = await fetchDocument(candidate.url, {
        allowPrivateNetwork: options.allowPrivateNetwork,
        proxy: body.proxy,
      })
      feed = parseFeedDocument(second.body, second.url)
      resolvedUrl = second.url
      discoveredFrom = first.url
    }

    if (!feed.title) feed.title = new URL(resolvedUrl).hostname
    if (!feed.siteUrl) feed.siteUrl = new URL(resolvedUrl).origin

    return c.json({
      feed,
      feedUrl: resolvedUrl,
      ...(discoveredFrom ? { discoveredFrom } : {}),
      ...(first.etag ? { etag: first.etag } : {}),
      ...(first.lastModified ? { lastModified: first.lastModified } : {}),
    })
  })

  app.post('/feed/discover', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: string; proxy?: string }
    const rawUrl = normalizeUrl(body.url ?? '')
    if (!rawUrl) return c.json({ error: '请提供网址', code: 'missing_url' }, 400)

    const result = await fetchDocument(rawUrl, {
      allowPrivateNetwork: options.allowPrivateNetwork,
      proxy: body.proxy,
    })
    if (guessContentType(result.contentType, result.body) === 'feed') {
      const feed = parseFeedDocument(result.body, result.url)
      return c.json({
        siteUrl: feed.siteUrl ?? new URL(result.url).origin,
        ...(feed.title ? { title: feed.title } : {}),
        candidates: [{ url: result.url, title: feed.title, type: feed.format }],
      })
    }
    const discovery = discoverFeeds(result.body, result.url)
    return c.json(discovery)
  })

  app.post('/article/extract', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: string; proxy?: string }
    const rawUrl = normalizeUrl(body.url ?? '')
    if (!rawUrl) return c.json({ error: '请提供文章链接', code: 'missing_url' }, 400)

    const result = await fetchDocument(rawUrl, {
      allowPrivateNetwork: options.allowPrivateNetwork,
      proxy: body.proxy,
    })
    const article = extractArticle(result.body, result.url)
    if (article.textLength < 120) {
      return c.json({ error: '未能从该页面提取到正文，可能需要在原站阅读。', code: 'no_content' }, 422)
    }
    return c.json({ article })
  })

  app.get('/icon', async (c) => {
    const rawUrl = c.req.query('url')
    if (!rawUrl) return c.json({ error: '缺少 url 参数' }, 400)
    const siteUrl = normalizeUrl(rawUrl)
    const cached = iconCache.get(siteUrl)
    if (cached && cached.expiresAt > Date.now()) {
      return new Response(toArrayBuffer(cached.body), {
        headers: { 'content-type': cached.contentType, 'cache-control': 'public, max-age=604800' },
      })
    }

    let iconUrl: string | undefined
    try {
      const page = await fetchDocument(siteUrl, {
        allowPrivateNetwork: options.allowPrivateNetwork,
        maxBytes: 2 * 1024 * 1024,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.8,*/*;q=0.5',
      })
      if (guessContentType(page.contentType, page.body) === 'feed') {
        const feed = parseFeedDocument(page.body, page.url)
        iconUrl = feed.iconUrl ?? absolutizeUrl('/favicon.ico', feed.siteUrl ?? page.url)
      } else {
        iconUrl = discoverIcon(page.body, page.url)
      }
    } catch {
      iconUrl = undefined
    }

    if (!iconUrl) {
      try {
        iconUrl = new URL('/favicon.ico', siteUrl).toString()
      } catch {
        return c.json({ error: '无法获取站点图标' }, 404)
      }
    }

    try {
      const binary = await fetchBinary(iconUrl, { allowPrivateNetwork: options.allowPrivateNetwork })
      const contentType = /image\//i.test(binary.contentType) ? binary.contentType : 'image/x-icon'
      rememberIcon(siteUrl, { body: binary.body, contentType, expiresAt: Date.now() + ICON_TTL })
      return new Response(toArrayBuffer(binary.body), {
        headers: { 'content-type': contentType, 'cache-control': 'public, max-age=604800' },
      })
    } catch {
      return c.json({ error: '无法获取站点图标' }, 404)
    }
  })

  app.get('/image', async (c) => {
    const rawUrl = c.req.query('url')
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return c.json({ error: '缺少合法的 url 参数' }, 400)
    const binary = await fetchBinary(rawUrl, { allowPrivateNetwork: options.allowPrivateNetwork })
    if (!/^image\//i.test(binary.contentType)) return c.json({ error: '目标不是图片' }, 415)
    return new Response(toArrayBuffer(binary.body), {
      headers: {
        'content-type': binary.contentType,
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
      },
    })
  })

  return app
}
