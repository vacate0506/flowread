import { XMLParser } from 'fast-xml-parser'
import type { FeedEnclosure, FeedFormat, ParsedFeed, ParsedItem } from './types'
import {
  absolutizeUrl,
  decodeEntities,
  firstImageFromHtml,
  parseDate,
  pickFromSrcset,
  stripHtml,
  truncate,
} from './utils'

export class FeedParseError extends Error {
  override name = 'FeedParseError'
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '#cdata',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  allowBooleanAttributes: true,
  processEntities: true,
  htmlEntities: true,
})

type XmlNode = Record<string, unknown>

function isRecord(value: unknown): value is XmlNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

/** Concatenate every text descendant of a fast-xml-parser node. */
function textOf(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isRecord(node)) {
    if ('#cdata' in node) return textOf(node['#cdata'])
    if ('#text' in node) return textOf(node['#text'])
    let out = ''
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('@_')) continue
      out += textOf(value)
    }
    return out
  }
  return ''
}

function attr(node: unknown, name: string): string | undefined {
  if (!isRecord(node)) return undefined
  const value = node[`@_${name}`]
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

function cleanTitle(node: unknown): string {
  const raw = textOf(Array.isArray(node) ? node[0] : node)
  return decodeEntities(stripHtml(raw)).replace(/\s+/g, ' ').trim()
}

/** Atom links carry rel/type, RSS links are plain text. */
function resolveLink(node: unknown, baseUrl: string): string {
  if (node == null) return ''
  const candidates = asArray(node as XmlNode | XmlNode[] | string)
  let fallback = ''
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      if (!fallback) fallback = candidate
      continue
    }
    if (!isRecord(candidate)) continue
    const href = attr(candidate, 'href') ?? textOf(candidate)
    if (!href) continue
    const rel = attr(candidate, 'rel') ?? 'alternate'
    if (rel === 'alternate' || rel === 'self') {
      return absolutizeUrl(decodeEntities(href.trim()), baseUrl)
    }
    if (!fallback) fallback = href
  }
  return fallback ? absolutizeUrl(decodeEntities(fallback.trim()), baseUrl) : ''
}

function firstUrl(node: unknown): string | undefined {
  for (const candidate of asArray<unknown>(node)) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (isRecord(candidate)) {
      const url = attr(candidate, 'url') ?? attr(candidate, 'href')
      if (url) return url
      const text = textOf(candidate).trim()
      if (text) return text
    }
  }
  return undefined
}

function resolveImage(item: XmlNode, contentHtml: string, baseUrl: string, feedImage?: string): string | undefined {
  const media = asArray(
    item['media:content'] ?? item['media:thumbnail'] ?? item['itunes:image'] ?? undefined,
  ) as XmlNode[]
  for (const node of media) {
    const url = attr(node, 'url') ?? attr(node, 'href')
    if (url) return absolutizeUrl(url, baseUrl)
  }

  const enclosure = asArray(item.enclosure) as XmlNode[]
  for (const node of enclosure) {
    const type = attr(node, 'type') ?? ''
    const url = attr(node, 'url')
    if (url && type.startsWith('image/')) return absolutizeUrl(url, baseUrl)
  }

  const fromHtml = firstImageFromHtml(contentHtml, baseUrl)
  if (fromHtml) return fromHtml

  const imageField = item.image
  if (typeof imageField === 'string' && imageField.trim()) return absolutizeUrl(imageField.trim(), baseUrl)
  if (isRecord(imageField)) {
    const url = firstUrl(imageField)
    if (url) return absolutizeUrl(url, baseUrl)
  }

  return feedImage
}

function parseCategories(item: XmlNode): string[] {
  const nodes = asArray(item.category ?? item['dc:subject'] ?? undefined)
  const seen = new Set<string>()
  const out: string[] = []
  for (const node of nodes) {
    const label = attr(node, 'term') ?? attr(node, 'label') ?? cleanTitle(node)
    if (label && !seen.has(label)) {
      seen.add(label)
      out.push(truncate(label, 40))
    }
  }
  return out
}

function parseEnclosures(item: XmlNode, baseUrl: string): FeedEnclosure[] {
  const out: FeedEnclosure[] = []
  for (const node of asArray(item.enclosure ?? item['media:content'] ?? undefined) as XmlNode[]) {
    const url = attr(node, 'url')
    if (!url) continue
    const type = attr(node, 'type')
    const length = Number.parseInt(attr(node, 'length') ?? '', 10)
    out.push({
      url: absolutizeUrl(url, baseUrl),
      ...(type ? { type } : {}),
      ...(Number.isFinite(length) ? { length } : {}),
    })
  }
  return out
}

function buildItem(item: XmlNode, baseUrl: string, feedImage: string | undefined): ParsedItem {
  const contentRaw = textOf(
    item['content:encoded'] ?? item['content'] ?? item['description'] ?? item['summary'] ?? '',
  ).trim()
  const descriptionRaw = textOf(item['summary'] ?? item['description'] ?? '').trim()
  const contentHtml = absolutizeHtml(contentRaw, baseUrl)
  const plain = stripHtml(contentHtml)
  const rawLink =
    resolveLink(item.link, baseUrl) ||
    (typeof item.guid === 'string' && /^https?:/i.test(item.guid) ? item.guid : '') ||
    resolveLink(item.url, baseUrl)
  const link = rawLink ? absolutizeUrl(decodeEntities(rawLink), baseUrl) : baseUrl

  const guidNode = item.guid ?? item.id
  const guidText = textOf(guidNode).trim()
  const title = cleanTitle(item.title ?? item['media:title'] ?? '') || truncate(plain, 80) || '无标题'
  const author =
    cleanTitle(item['dc:creator'] ?? item.author ?? item['itunes:author'] ?? item.creator ?? '') || undefined
  const publishedAt =
    parseDate(textOf(item.pubDate ?? item.published ?? item.updated ?? item['dc:date'] ?? '')) ?? undefined
  const imageUrl = resolveImage(item, contentHtml, baseUrl, feedImage)
  const enclosures = parseEnclosures(item, baseUrl)
  const audio = enclosures.find((candidate) => candidate.type?.startsWith('audio/'))
  const durationRaw = textOf(item['itunes:duration'] ?? '').trim()
  let duration: number | undefined
  if (durationRaw) {
    const parts = durationRaw.split(':').map((part) => Number.parseInt(part, 10))
    if (parts.every((part) => Number.isFinite(part))) {
      duration = parts.reduce((acc, part) => acc * 60 + part, 0)
    }
  }

  const summarySource = stripHtml(descriptionRaw) || plain

  return {
    guid: guidText || link,
    title,
    link,
    summary: truncate(summarySource.replace(/\s+/g, ' ').trim(), 400),
    contentHtml,
    ...(author ? { author } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    categories: parseCategories(item),
    enclosures,
    ...(audio ? { audioUrl: audio.url } : {}),
    ...(duration ? { duration } : {}),
  }
}

/** Rewrite relative `href`/`src` attributes so article HTML survives outside the feed. */
function absolutizeHtml(html: string, baseUrl: string): string {
  if (!html || !baseUrl) return html
  return html.replace(
    /(<(?:a|img|video|audio|source|iframe)\b[^>]*?\s(?:href|src|poster)\s*=\s*)(["'])([^"']+)\2/gi,
    (_match, prefix: string, quote: string, url: string) => {
      if (/^(https?:|mailto:|data:|javascript:|#)/i.test(url)) return `${prefix}${quote}${url}${quote}`
      return `${prefix}${quote}${absolutizeUrl(url, baseUrl)}${quote}`
    },
  )
}

function parseJsonFeed(raw: string, feedUrl: string): ParsedFeed {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new FeedParseError('不是有效的 JSON Feed')
  }
  if (!Array.isArray(data.items)) throw new FeedParseError('JSON Feed 缺少 items 字段')
  const siteUrl = typeof data.home_page_url === 'string' ? data.home_page_url : undefined
  const iconUrl =
    (typeof data.icon === 'string' && data.icon) ||
    (typeof data.favicon === 'string' && data.favicon) ||
    (siteUrl ? `${siteUrl.replace(/\/$/, '')}/favicon.ico` : undefined)

  const items: ParsedItem[] = []
  for (const entry of data.items as Record<string, unknown>[]) {
    if (!isRecord(entry)) continue
    const contentHtml =
      (typeof entry.content_html === 'string' && entry.content_html) ||
      (typeof entry.content_text === 'string' ? `<p>${entry.content_text}</p>` : '')
    const plain = stripHtml(contentHtml)
    const title = (typeof entry.title === 'string' && entry.title.trim()) || truncate(plain, 80) || '无标题'
    const link = typeof entry.url === 'string' ? entry.url : feedUrl
    const authorNode = entry.authors ?? entry.author
    let author: string | undefined
    if (Array.isArray(authorNode) && isRecord(authorNode[0])) {
      author = typeof authorNode[0].name === 'string' ? authorNode[0].name : undefined
    } else if (isRecord(authorNode)) {
      author = typeof authorNode.name === 'string' ? authorNode.name : undefined
    }
    const summary =
      (typeof entry.summary === 'string' && entry.summary) ||
      (typeof entry.content_text === 'string' ? entry.content_text : plain)
    const image =
      (typeof entry.image === 'string' && entry.image) ||
      (typeof entry.banner_image === 'string' && entry.banner_image) ||
      firstImageFromHtml(contentHtml, link)
    const enclosures: FeedEnclosure[] = []
    for (const attachment of asArray(entry.attachments as Record<string, unknown>[] | undefined)) {
      if (!isRecord(attachment)) continue
      const url = typeof attachment.url === 'string' ? attachment.url : undefined
      if (!url) continue
      const type = typeof attachment.mime_type === 'string' ? attachment.mime_type : undefined
      const size = typeof attachment.size_in_bytes === 'number' ? attachment.size_in_bytes : undefined
      enclosures.push({ url, ...(type ? { type } : {}), ...(size ? { length: size } : {}) })
    }
    items.push({
      guid:
        (typeof entry.id === 'string' && entry.id) ||
        (typeof entry.url === 'string' && entry.url) ||
        `${title}-${String(entry.date_published ?? '')}`,
      title: cleanTitle(title),
      link,
      summary: truncate(summary.replace(/\s+/g, ' ').trim(), 400),
      contentHtml,
      ...(author ? { author } : {}),
      ...(typeof entry.date_published === 'string' || typeof entry.date_modified === 'string'
        ? { publishedAt: parseDate(entry.date_published ?? entry.date_modified) }
        : {}),
      ...(image ? { imageUrl: absolutizeUrl(image, link) } : {}),
      categories: asArray(entry.tags as string[] | undefined).filter((tag) => typeof tag === 'string').slice(0, 8),
      enclosures,
    })
  }

  return {
    url: feedUrl,
    title: cleanTitle(data.title) || new URL(feedUrl).hostname,
    ...(siteUrl ? { siteUrl } : {}),
    ...(typeof data.description === 'string' ? { description: stripHtml(data.description) } : {}),
    ...(iconUrl ? { iconUrl } : {}),
    ...(typeof data.language === 'string' ? { language: data.language } : {}),
    format: 'json',
    items,
  }
}

function looksLikeJson(raw: string): boolean {
  const head = raw.replace(/^\uFEFF/, '').trimStart().slice(0, 1)
  return head === '{'
}

/** Parse an RSS 2.0 / RSS 1.0 / Atom document. */
export function parseFeedDocument(raw: string, feedUrl: string): ParsedFeed {
  const content = raw.replace(/^\uFEFF/, '').trim()
  if (!content) throw new FeedParseError('订阅源返回了空内容')
  if (looksLikeJson(content)) return parseJsonFeed(content, feedUrl)

  let document: XmlNode
  try {
    document = parser.parse(content) as XmlNode
  } catch (error) {
    throw new FeedParseError(`XML 解析失败：${(error as Error).message}`)
  }

  const rss = document.rss as XmlNode | undefined
  const channel = rss?.channel as XmlNode | undefined
  const atom = document.feed as XmlNode | undefined
  const rdf = document['rdf:RDF'] as XmlNode | undefined
  const rdfChannel = rdf?.channel as XmlNode | undefined

  let format: FeedFormat
  let entries: XmlNode[]
  let channelNode: XmlNode

  if (channel) {
    format = 'rss'
    channelNode = channel
    entries = asArray(channel.item as XmlNode[] | undefined)
  } else if (atom) {
    format = 'atom'
    channelNode = atom
    entries = asArray(atom.entry as XmlNode[] | undefined)
  } else if (rdf) {
    format = 'rss'
    channelNode = rdfChannel ?? rdf
    entries = asArray((rdf.item ?? rdfChannel?.item) as XmlNode[] | undefined)
  } else {
    throw new FeedParseError('无法识别的订阅格式（支持 RSS 2.0 / RSS 1.0 / Atom / JSON Feed）')
  }

  const siteUrl =
    resolveLink(channelNode.link, feedUrl) ||
    resolveLink(channelNode['atom:link'], feedUrl) ||
    (typeof channelNode['@_rdf:about'] === 'string' ? channelNode['@_rdf:about'] : '') ||
    new URL(feedUrl).origin

  const iconUrl =
    firstUrl((channelNode.image as XmlNode | undefined)?.url) ||
    firstUrl(channelNode.icon) ||
    firstUrl(channelNode.logo) ||
    firstUrl(channelNode['itunes:image']) ||
    attr(asArray(channelNode['itunes:image'])[0], 'href') ||
    undefined

  const feedImage = iconUrl ? absolutizeUrl(iconUrl, feedUrl) : undefined
  const items = entries
    .filter((entry) => isRecord(entry))
    .map((entry) => buildItem(entry, feedUrl, feedImage))
    .filter((item) => item.link || item.title)

  const title =
    cleanTitle(channelNode.title) ||
    (format === 'atom' ? new URL(feedUrl).hostname : '') ||
    new URL(feedUrl).hostname
  const description = stripHtml(textOf(channelNode.description ?? channelNode.subtitle ?? channelNode.tagline ?? ''))

  return {
    url: feedUrl,
    title: truncate(title, 120),
    ...(siteUrl ? { siteUrl } : {}),
    ...(description ? { description: truncate(description, 300) } : {}),
    ...(feedImage ? { iconUrl: feedImage } : {}),
    ...(textOf(channelNode.language ?? channelNode['dc:language'] ?? '').trim()
      ? { language: textOf(channelNode.language ?? channelNode['dc:language']).trim() }
      : {}),
    format,
    items: items.slice(0, 300),
  }
}

/** True when the payload is probably a feed, used by URL auto-discovery. */
export function looksLikeFeedPayload(contentType: string, body: string): boolean {
  const head = body.replace(/^\uFEFF/, '').trimStart().slice(0, 400).toLowerCase()
  return (
    /(rss|atom|rdf|feed\+json)/.test(contentType.toLowerCase()) ||
    head.startsWith('<?xml') ||
    head.startsWith('<rss') ||
    head.startsWith('<feed') ||
    head.startsWith('<rdf') ||
    head.startsWith('{')
  )
}

export { pickFromSrcset }
