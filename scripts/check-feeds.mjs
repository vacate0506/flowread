/**
 * Smoke-test the feed pipeline against a real OPML file.
 *   node scripts/check-feeds.mjs [path/to/subscriptions.opml] [apiBase]
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const opmlPath = resolve(process.argv[2] ?? 'feedbro-subscriptions.opml')
const apiBase = process.argv[3] ?? 'http://127.0.0.1:8787'

const xml = await readFile(opmlPath, 'utf8')
const feeds = [...xml.matchAll(/<outline\b[^>]*>/g)]
  .map((match) => {
    const tag = match[0]
    const xmlUrl = /\bxmlUrl="([^"]+)"/.exec(tag)?.[1]
    const title = /\btitle="([^"]*)"/.exec(tag)?.[1] ?? xmlUrl ?? ''
    return xmlUrl ? { url: xmlUrl.trim(), title } : null
  })
  .filter(Boolean)

if (feeds.length === 0) {
  console.error('No feeds found in', opmlPath)
  process.exit(1)
}

const results = await Promise.allSettled(
  feeds.map(async (feed) => {
    const started = Date.now()
    const response = await fetch(`${apiBase}/api/feed/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: feed.url }),
      signal: AbortSignal.timeout(45_000),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
    return { ...feed, ms: Date.now() - started, ...data }
  }),
)

let failed = 0
for (const [index, result] of results.entries()) {
  const feed = feeds[index]
  if (result.status === 'rejected') {
    failed++
    console.log(`✗ ${feed.title}\n    ${result.reason?.message ?? result.reason}\n    ${feed.url}`)
    continue
  }
  const value = result.value
  const newest = value.feed.items
    .map((item) => item.publishedAt ?? 0)
    .sort((a, b) => b - a)[0]
  const when = newest ? new Date(newest).toISOString().slice(0, 16).replace('T', ' ') : 'n/a'
  const withImages = value.feed.items.filter((item) => item.imageUrl).length
  console.log(
    `✓ ${value.feed.title} [${value.feed.format}] ${value.feed.items.length} items, ${withImages} with image, newest ${when}, ${value.ms}ms`,
  )
}

console.log(`\n${feeds.length - failed}/${feeds.length} feeds ok`)
process.exitCode = failed === 0 ? 0 : 1
