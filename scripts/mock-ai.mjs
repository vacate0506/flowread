/**
 * Minimal OpenAI-compatible mock used by scripts/screenshots.mjs and manual
 * testing of the AI summary / translation UI without spending tokens.
 *   node scripts/mock-ai.mjs [port]
 */
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 9999)

const summaryMarkdown = `> 这篇文章介绍了开源社区在 2024 年发布的一款新工具，用于简化跨平台内容分发。

## 核心观点
- 新工具用一套代码同时覆盖 Web、桌面与移动端，减少重复实现。
- 默认离线优先：文章与阅读状态保存在本地 IndexedDB 中。
- 通过可插拔的 AI 服务完成摘要与翻译，密钥只保存在用户设备上。

## 关键细节
项目在 10 月 1 日发布了 1.0 版本，包含 RSS 2.0、Atom 与 JSON Feed 支持。作者强调阅读体验的核心是「安静」：没有弹窗、没有推荐流，只有一个按时间排列的列表。

## 值得关注
- 关注后续的多设备同步方案。
- 如果自建服务，注意给抓取接口加上内网访问限制。`

function translationFor(text) {
  return `【译】${text}`
}

function sendSse(res, chunks, delay = 18) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  let index = 0
  const timer = setInterval(() => {
    if (index >= chunks.length) {
      clearInterval(timer)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    const payload = { choices: [{ delta: { content: chunks[index] } }] }
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
    index += 1
  }, delay)
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    })
    res.end()
    return
  }
  if (req.method === 'GET' && req.url?.includes('/models')) {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    res.end(
      JSON.stringify({
        object: 'list',
        data: [
          { id: 'mock-gpt', object: 'model' },
          { id: 'mock-gpt-mini', object: 'model' },
          { id: 'mock-reasoner', object: 'model' },
        ],
      }),
    )
    return
  }
  if (!req.url?.includes('/chat/completions')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'not found' } }))
    return
  }

  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    let payload = {}
    try {
      payload = JSON.parse(body)
    } catch {
      /* ignore */
    }
    const messages = payload.messages ?? []
    const user = [...messages].reverse().find((message) => message.role === 'user')?.content ?? ''
    const system = messages.find((message) => message.role === 'system')?.content ?? ''
    const isTranslation = system.includes('翻译') || /^\[\d+\]/m.test(user.split('\n').slice(-1)[0] ?? '')

    if (!payload.stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '正常' } }] }))
      return
    }

    if (isTranslation) {
      const blocks = [...user.matchAll(/^\[(-?\d+)\]\s*([^\n]*)$/gm)].map((match) => ({
        index: match[1],
        text: match[2],
      }))
      const lines = []
      for (const block of blocks) {
        lines.push(`${block.index}||${translationFor(block.text)}`)
      }
      const chunks = lines.join('\n').match(/[\s\S]{1,24}/g) ?? []
      sendSse(res, chunks, 8)
      return
    }

    const chunks = summaryMarkdown.match(/[\s\S]{1,20}/g) ?? []
    sendSse(res, chunks, 8)
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-ai] http://127.0.0.1:${port}/v1`)
})
