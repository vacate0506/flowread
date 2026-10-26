import type { ExtractedArticle, FeedDiscoveryResult } from '@flowread/shared'

/**
 * Browser-side article extraction + feed discovery for the Tauri desktop app,
 * where no Node server is available. Mirrors the Hono server implementation but
 * uses DOMParser instead of cheerio.
 */

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
  'loading',
  'target',
  'rel',
])

function absolutize(url: string, base: string): string {
  if (!url) return url
  if (/^(https?:|mailto:|data:|blob:)/i.test(url)) return url
  try {
    return new URL(url, base).toString()
  } catch {
    return url
  }
}

function metaContent(doc: Document, names: string[]): string | undefined {
  for (const name of names) {
    const value = doc
      .querySelector(`meta[property="${name}"], meta[name="${name}"]`)
      ?.getAttribute('content')
    if (value?.trim()) return value.trim()
  }
  return undefined
}

function depthOf(element: Element): number {
  let depth = 0
  let current: Element | null = element
  while (current && depth < 64) {
    depth += 1
    current = current.parentElement
  }
  return depth
}

function pickContentRoot(doc: Document): Element {
  for (const selector of CONTENT_SELECTORS) {
    const element = doc.querySelector(selector)
    if (element && (element.textContent ?? '').trim().length > 400) return element
  }

  let best: Element | null = null
  let bestScore = 0
  let bestDepth = -1
  for (const element of Array.from(doc.querySelectorAll('div, section'))) {
    let score = 0
    for (const paragraph of Array.from(element.querySelectorAll('p'))) {
      score += (paragraph.textContent ?? '').replace(/\s+/g, ' ').trim().length
    }
    if (score < 400) continue
    const depth = depthOf(element)
    if (score > bestScore * 1.02 || (score >= bestScore * 0.98 && depth > bestDepth)) {
      best = element
      bestScore = score
      bestDepth = depth
    }
  }
  return best ?? doc.body
}

function sanitize(root: Element, baseUrl: string): void {
  for (const element of Array.from(root.querySelectorAll('*'))) {
    const lazySource =
      element.getAttribute('data-src') ??
      element.getAttribute('data-original') ??
      element.getAttribute('data-lazy-src') ??
      element.getAttribute('data-actualsrc')
    for (const attribute of Array.from(element.attributes)) {
      if (!ALLOWED_ATTRIBUTES.has(attribute.name)) element.removeAttribute(attribute.name)
    }
    if (element.tagName === 'IMG' || element.tagName === 'SOURCE') {
      if (lazySource) element.setAttribute('src', lazySource)
      const src = element.getAttribute('src')
      if (src) element.setAttribute('src', absolutize(src, baseUrl))
      const srcset = element.getAttribute('srcset')
      if (srcset) {
        element.setAttribute(
          'srcset',
          srcset
            .split(',')
            .map((part) => {
              const [url, descriptor] = part.trim().split(/\s+/, 2)
              return `${absolutize(url ?? '', baseUrl)}${descriptor ? ` ${descriptor}` : ''}`
            })
            .join(', '),
        )
      }
    }
    if (element.tagName === 'A') {
      const href = element.getAttribute('href')
      if (href) element.setAttribute('href', absolutize(href, baseUrl))
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noopener noreferrer')
    }
  }
}

/** Readability-style extraction running in the WebView (Tauri mode). */
export function extractArticleFromHtml(html: string, url: string): ExtractedArticle {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href')
  const resolvedUrl = canonical ? absolutize(canonical, url) : url
  const title =
    metaContent(doc, ['og:title', 'twitter:title']) ??
    doc.querySelector('h1')?.textContent?.trim() ??
    doc.title.trim() ??
    undefined
  const byline =
    metaContent(doc, ['author', 'article:author', 'og:article:author']) ??
    doc.querySelector('[rel="author"]')?.textContent?.trim() ??
    doc.querySelector('.byline, .author, .post-author')?.textContent?.trim() ??
    undefined
  const siteName = metaContent(doc, ['og:site_name']) ?? new URL(resolvedUrl).hostname
  const excerpt = metaContent(doc, ['og:description', 'description', 'twitter:description'])
  const image = metaContent(doc, ['og:image', 'twitter:image'])

  for (const element of Array.from(doc.querySelectorAll(NOISE_SELECTORS.join(',')))) element.remove()

  const root = pickContentRoot(doc)
  sanitize(root, resolvedUrl)
  const resultHtml = root.innerHTML.trim()

  return {
    url: resolvedUrl,
    ...(title ? { title } : {}),
    ...(byline ? { byline } : {}),
    ...(siteName ? { siteName } : {}),
    ...(excerpt ? { excerpt } : {}),
    ...(image ? { imageUrl: absolutize(image, resolvedUrl) } : {}),
    html: resultHtml,
    textLength: (root.textContent ?? '').replace(/\s+/g, '').length,
  }
}

/** Find RSS/Atom/JSON feed links in an HTML document (Tauri mode). */
export function discoverFeedsFromHtml(html: string, pageUrl: string): FeedDiscoveryResult {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const candidates: FeedDiscoveryResult['candidates'] = []
  const seen = new Set<string>()

  const push = (url: string, title: string | undefined, type: string | undefined): void => {
    const resolved = absolutize(url, pageUrl)
    if (!/^https?:/i.test(resolved) || seen.has(resolved)) return
    seen.add(resolved)
    const format = /json/i.test(type ?? '') ? 'json' : /atom/i.test(type ?? '') ? 'atom' : 'rss'
    candidates.push({ url: resolved, ...(title ? { title } : {}), type: format })
  }

  for (const element of Array.from(doc.querySelectorAll('link[rel~="alternate"], link[rel="feed"]'))) {
    const type = (element.getAttribute('type') ?? '').toLowerCase()
    if (!/rss|atom|json|xml/.test(type)) continue
    const href = element.getAttribute('href')
    if (href) push(href, element.getAttribute('title') ?? undefined, type)
  }

  for (const element of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = element.getAttribute('href') ?? ''
    if (!/(\.rss|\.xml|\/feed\/?$|\/rss\/?$|atom\.xml|feed\.xml|index\.xml)/i.test(href)) continue
    if (element.closest('article, main')) continue
    push(href, element.textContent?.trim() || undefined, undefined)
  }

  const title =
    doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() ||
    doc.title.trim() ||
    undefined

  return { candidates: candidates.slice(0, 8), siteUrl: pageUrl, ...(title ? { title } : {}) }
}
