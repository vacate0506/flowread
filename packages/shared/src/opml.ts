import { XMLParser } from 'fast-xml-parser'
import type { OpmlDocument, OpmlFeed } from './types'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseAttributeValue: false,
  allowBooleanAttributes: true,
})

type OutlineNode = Record<string, unknown>

function attr(node: OutlineNode, name: string): string | undefined {
  const value = node[`@_${name}`]
  return typeof value === 'string' ? value : undefined
}

function outlineTitle(node: OutlineNode): string {
  return (attr(node, 'title') ?? attr(node, 'text') ?? '').trim()
}

/** Flatten an OPML document into feeds (keeping nested folder paths). */
export function parseOpml(raw: string): OpmlDocument {
  const document = parser.parse(raw.replace(/^\uFEFF/, '')) as Record<string, unknown>
  const opml = document.opml as OutlineNode | undefined
  const body = (opml?.body ?? document.body) as OutlineNode | undefined
  if (!body) throw new Error('OPML 文件缺少 body 节点')

  const feeds: OpmlFeed[] = []
  const folders = new Set<string>()

  const walk = (node: OutlineNode, trail: string[]): void => {
    const outlines = node.outline
    const list = outlines == null ? [] : Array.isArray(outlines) ? outlines : [outlines]
    for (const child of list) {
      if (typeof child !== 'object' || child === null) continue
      const outline = child as OutlineNode
      const xmlUrl = attr(outline, 'xmlUrl')
      const title = outlineTitle(outline)
      if (xmlUrl) {
        const folder = trail.join(' / ') || undefined
        if (folder) folders.add(folder)
        feeds.push({
          title: title || xmlUrl,
          xmlUrl,
          ...(attr(outline, 'htmlUrl') ? { htmlUrl: attr(outline, 'htmlUrl') } : {}),
          ...(folder ? { folder } : {}),
        })
        continue
      }
      const nextTrail = title ? [...trail, title] : trail
      walk(outline, nextTrail)
    }
  }

  walk(body, [])
  if (feeds.length === 0) throw new Error('OPML 文件里没有找到任何订阅')

  const titleNode = opml?.head as OutlineNode | undefined
  return {
    title: (titleNode ? outlineTitle(titleNode) : '') || 'FlowRead 订阅',
    feeds,
    folders: [...folders],
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Serialise feeds back into a portable OPML 2.0 document. */
export function generateOpml(feeds: { title: string; url: string; siteUrl?: string; folder?: string }[]): string {
  const byFolder = new Map<string, typeof feeds>()
  for (const feed of feeds) {
    const key = feed.folder ?? ''
    const bucket = byFolder.get(key) ?? []
    bucket.push(feed)
    byFolder.set(key, bucket)
  }
  const groups = [...byFolder.entries()].sort(([a], [b]) => a.localeCompare(b))
  const body = groups
    .map(([folder, bucket]) => {
      const items = bucket
        .map(
          (feed) =>
            `      <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.url)}"${
              feed.siteUrl ? ` htmlUrl="${escapeXml(feed.siteUrl)}"` : ''
            } />`,
        )
        .join('\n')
      if (!folder) return items
      return `    <outline text="${escapeXml(folder)}" title="${escapeXml(folder)}">\n${items}\n    </outline>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>FlowRead subscriptions</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${body}
  </body>
</opml>
`
}
