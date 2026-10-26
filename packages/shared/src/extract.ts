import { load, type CheerioAPI } from 'cheerio'
import type { ExtractedArticle, FeedDiscoveryResult } from './types'
import { absolutizeUrl } from './utils'

const NOISE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'form',
  'nav',
  'header',
  'footer',
  'aside',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="complementary"]',
  '[aria-hidden="true"]',
  '.advert',
  '.ads',
  '.ad',
  '.advertisement',
  '.share',
  '.social',
  '.newsletter',
  '.subscribe',
  '.related',
  '.recommend',
  '.comments',
  '#comments',
  '.comment-list',
  '.cookie',
  '.popup',
  '.modal',
  '.sidebar',
  '.breadcrumb',
  '.pagination',
  '.pager',
  '.toolbar',
  '.post-navigation',
  '.author-box',
]

const CONTENT_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  '.post-content',
  '.article-content',
  '.article-body',
  '.entry-content',
  '.post-body',
  '.markdown-body',
  '.rich_media_content',
  '#js_content',
  '.content',
  '#content',
]

const ALLOWED_ATTRIBUTES = new Set([
  'href',
  'src',
  'srcset',
  'sizes',
  'alt',
  'title',
  'width',
  'height',
  'colspan',
  'rowspan',
  'datetime',
  'cite',
  'start',
  'reversed',
  'type',
  'controls',
  'poster',
])

function metaContent($: CheerioAPI, names: string[]): string | undefined {
  for (const name of names) {
    const value = $(`meta[property="${name}"], meta[name="${name}"]`).first().attr('content')
    if (value && value.trim()) return value.trim()
  }
  return undefined
}

function depthOf(element: unknown): number {
  let depth = 0
  let current = element as { parent?: unknown } | undefined
  while (current && depth < 64) {
    depth++
    current = current.parent as { parent?: unknown } | undefined
  }
  return depth
}

/** Pick the densest plausible article container. */
function pickContentRoot($: CheerioAPI): { root: ReturnType<CheerioAPI>; selector: string } {
  for (const selector of CONTENT_SELECTORS) {
    const node = $(selector).first()
    if (node.length && node.text().trim().length > 400) return { root: node, selector }
  }

  let bestScore = 0
  let bestDepth = -1
  let bestElement: unknown = null
  let bestSelector = 'body'

  $('div, section').each((_, element) => {
    const node = $(element)
    let score = 0
    node.find('p').each((_, paragraph) => {
      score += $(paragraph).text().replace(/\s+/g, ' ').trim().length
    })
    if (score < 400) return
    const depth = depthOf(element)
    if (score > bestScore * 1.02 || (score >= bestScore * 0.98 && depth > bestDepth)) {
      bestScore = score
      bestDepth = depth
      bestElement = element
      bestSelector = 'div'
    }
  })

  if (bestElement) return { root: $(bestElement as never), selector: bestSelector }
  return { root: $('body'), selector: 'body' }
}

function sanitize($: CheerioAPI, root: ReturnType<CheerioAPI>, baseUrl: string): void {
  root.find(NOISE_SELECTORS.join(',')).remove()
  root.find('br').filter((_, el) => $(el).next().length === 0).remove()

  root.find('*').each((_, element) => {
    const node = $(element)
    const lazySource =
      node.attr('data-src') ??
      node.attr('data-original') ??
      node.attr('data-lazy-src') ??
      node.attr('data-actualsrc')
    const attribs = node.attr() ?? {}
    for (const name of Object.keys(attribs)) {
      if (!ALLOWED_ATTRIBUTES.has(name)) node.removeAttr(name)
    }
    if (element.tagName === 'img' || element.tagName === 'source') {
      if (lazySource) node.attr('src', lazySource)
      const src = node.attr('src')
      if (src) node.attr('src', absolutizeUrl(src, baseUrl))
      const href = node.attr('href')
      if (href) node.attr('href', absolutizeUrl(href, baseUrl))
    }
    if (element.tagName === 'a') {
      const href = node.attr('href')
      if (href) node.attr('href', absolutizeUrl(href, baseUrl))
      node.attr('target', '_blank')
      node.attr('rel', 'noopener noreferrer')
    }
  })

  // Drop empty wrappers left behind by removed ads / embeds.
  root
    .find('p, div, span')
    .filter((_, el) => {
      const node = $(el)
      return node.children().length === 0 && node.text().replace(/\s+/g, '').length === 0
    })
    .remove()
}

/** Readability-style main content extraction. */
export function extractArticle(html: string, url: string): ExtractedArticle {
  const $ = load(html)
  const siteUrl = (() => {
    try {
      return new URL(url).origin
    } catch {
      return url
    }
  })()

  const canonical = $('link[rel="canonical"]').attr('href')
  const resolvedUrl = canonical ? absolutizeUrl(canonical, url) : url
  const title =
    metaContent($, ['og:title', 'twitter:title']) ??
    ($('h1').first().text().trim() || undefined) ??
    ($('title').first().text().trim() || undefined)
  const byline =
    metaContent($, ['author', 'article:author', 'og:article:author']) ??
    ($('[rel="author"]').first().text().trim() || undefined) ??
    ($('.byline, .author, .post-author').first().text().trim() || undefined)
  const siteName = metaContent($, ['og:site_name']) ?? new URL(resolvedUrl).hostname
  const excerpt = metaContent($, ['og:description', 'description', 'twitter:description'])
  const image = metaContent($, ['og:image', 'twitter:image'])

  const { root } = pickContentRoot($)
  sanitize($, root, resolvedUrl)

  const resultHtml = root.html()?.trim() ?? ''
  const textLength = root.text().replace(/\s+/g, '').length

  return {
    url: resolvedUrl,
    ...(title ? { title } : {}),
    ...(byline ? { byline } : {}),
    ...(siteName ? { siteName } : {}),
    ...(excerpt ? { excerpt } : {}),
    ...(image ? { imageUrl: absolutizeUrl(image, siteUrl) } : {}),
    html: resultHtml,
    textLength,
  }
}

/** Find RSS/Atom/JSON feed links inside an HTML page. */
export function discoverFeeds(html: string, pageUrl: string): FeedDiscoveryResult {
  const $ = load(html)
  const candidates: FeedDiscoveryResult['candidates'] = []
  const seen = new Set<string>()

  const push = (url: string, title: string | undefined, type: string | undefined): void => {
    const resolved = absolutizeUrl(url, pageUrl)
    if (!/^https?:/i.test(resolved) || seen.has(resolved)) return
    seen.add(resolved)
    const format = /json/i.test(type ?? '') ? 'json' : /atom/i.test(type ?? '') ? 'atom' : 'rss'
    candidates.push({ url: resolved, ...(title ? { title } : {}), type: format })
  }

  $('link[rel~="alternate"], link[rel="feed"]').each((_, element) => {
    const node = $(element)
    const type = (node.attr('type') ?? '').toLowerCase()
    if (!/rss|atom|json|xml/.test(type)) return
    const href = node.attr('href')
    if (!href) return
    push(href, node.attr('title'), type)
  })

  $('a[href]').each((_, element) => {
    const node = $(element)
    const href = node.attr('href') ?? ''
    if (!/(\.rss|\.xml|\/feed\/?$|\/rss\/?$|atom\.xml|feed\.xml|index\.xml)/i.test(href)) return
    if (node.closest('article, main').length > 0) return
    push(href, node.text().trim() || undefined, undefined)
  })

  const title =
    $('meta[property="og:site_name"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    undefined

  return { candidates: candidates.slice(0, 8), siteUrl: pageUrl, ...(title ? { title } : {}) }
}

/** Best-effort site icon discovery, used when a feed has no logo. */
export function discoverIcon(html: string, pageUrl: string): string | undefined {
  const $ = load(html)
  const selectors = [
    'link[rel="apple-touch-icon"]',
    'link[rel="apple-touch-icon-precomposed"]',
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="mask-icon"]',
  ]
  for (const selector of selectors) {
    const href = $(selector).first().attr('href')
    if (href) return absolutizeUrl(href, pageUrl)
  }
  try {
    return new URL('/favicon.ico', pageUrl).toString()
  } catch {
    return undefined
  }
}
