/**
 * Minimal HTTP forward proxy for the proxy verification scripts.
 * It answers requests for example.com/proxy-*.xml itself and rejects
 * everything else, so a subscription only resolves when it goes through it.
 *
 *   node scripts/mock-proxy.mjs 8899
 */
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 8899)
const article = (title, path) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${title}</title>
    <link>http://example.com/</link>
    <description>Fetched through the local mock proxy</description>
    <item>
      <title>${title} article</title>
      <link>http://example.com${path}-article</link>
      <guid>${path}-1</guid>
      <pubDate>Mon, 26 Oct 2026 08:00:00 GMT</pubDate>
      <description>Proxied article body.</description>
    </item>
  </channel>
</rss>`

const server = createServer((req, res) => {
  console.log('proxy', req.method, req.url)
  if (req.method !== 'GET') {
    res.writeHead(405)
    res.end('method not allowed')
    return
  }
  if (req.url?.includes('/proxy-all.xml')) {
    res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' })
    res.end(article('Proxy Feed All', '/proxy-all'))
    return
  }
  if (req.url?.includes('/proxy-selected.xml')) {
    res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' })
    res.end(article('Proxy Feed Selected', '/proxy-selected'))
    return
  }
  res.writeHead(502, { 'content-type': 'text/plain' })
  res.end('mock proxy: only proxy-all.xml and proxy-selected.xml are served')
})

server.listen(port, '127.0.0.1', () => {
  console.log(`mock proxy listening on http://127.0.0.1:${port}`)
})
