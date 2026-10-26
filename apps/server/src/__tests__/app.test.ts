import { describe, expect, it } from 'vitest'
import { createApp } from '../app'
import type { ServerOptions } from '../config'

const options: ServerOptions = {
  port: 0,
  host: '127.0.0.1',
  allowPrivateNetwork: false,
  version: 'test',
}

const app = createApp(options)

describe('API surface', () => {
  it('reports health', async () => {
    const response = await app.request('/api/health')
    expect(response.status).toBe(200)
    const data = (await response.json()) as { ok: boolean; name: string; version: string; web: boolean }
    expect(data.ok).toBe(true)
    expect(data.name).toBe('FlowRead')
    expect(data.version).toBe('test')
    expect(data.web).toBe(false)
  })

  it('returns a json 404 for unknown api routes', async () => {
    const response = await app.request('/api/nope')
    expect(response.status).toBe(404)
    const data = (await response.json()) as { code: string }
    expect(data.code).toBe('not_found')
  })

  it('serves a plain-text hint when no web build is configured', async () => {
    const response = await app.request('/')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('FlowRead API is running')
  })
})

describe('AI route validation', () => {
  const ai = { provider: 'custom', baseUrl: 'http://127.0.0.1:9999/v1', model: 'mock', apiKey: 'k' }

  it('rejects summaries without content', async () => {
    const response = await app.request('/api/ai/summarize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: { title: 'x', content: '  ', mode: 'tldr', language: 'zh-CN' }, ai }),
    })
    expect(response.status).toBe(400)
    const data = (await response.json()) as { code: string }
    expect(data.code).toBe('missing_content')
  })

  it('rejects unsupported summary modes', async () => {
    const response = await app.request('/api/ai/summarize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: { title: 'x', content: 'hello', mode: 'huge', language: 'zh-CN' }, ai }),
    })
    expect(response.status).toBe(400)
    const data = (await response.json()) as { code: string }
    expect(data.code).toBe('invalid_mode')
  })

  it('requires an api key for hosted providers', async () => {
    const response = await app.request('/api/ai/summarize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request: { title: 'x', content: 'hello', mode: 'tldr', language: 'zh-CN' },
        ai: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' },
      }),
    })
    expect(response.status).toBe(400)
    const data = (await response.json()) as { code: string }
    expect(data.code).toBe('invalid_ai_config')
  })

  it('requires an API key before listing models', async () => {
    const response = await app.request('/api/ai/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ai: {
          provider: 'deepseek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          apiKey: '',
        },
      }),
    })
    expect(response.status).toBe(400)
    const data = (await response.json()) as { code: string }
    expect(data.code).toBe('invalid_ai_config')
  })

  it('rejects empty translation batches', async () => {    const response = await app.request('/api/ai/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: { blocks: [], targetLanguage: 'zh-CN' }, ai }),
    })
    expect(response.status).toBe(400)
    const data = (await response.json()) as { code: string }
    expect(data.code).toBe('missing_blocks')
  })

  it('rejects oversized translation batches', async () => {
    const blocks = Array.from({ length: 90 }, (_, index) => ({ index, text: 'hello world' }))
    const response = await app.request('/api/ai/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: { blocks, targetLanguage: 'zh-CN' }, ai }),
    })
    expect(response.status).toBe(400)
    const data = (await response.json()) as { code: string }
    expect(data.code).toBe('too_many_blocks')
  })
})

describe('feed route validation', () => {
  it('requires a url', async () => {
    const response = await app.request('/api/feed/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: '   ' }),
    })
    expect(response.status).toBe(400)
    const data = (await response.json()) as { code: string }
    expect(data.code).toBe('missing_url')
  })

  it('rejects malformed urls', async () => {
    const response = await app.request('/api/feed/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'not a url at all' }),
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
    const data = (await response.json()) as { error?: string }
    expect(data.error).toBeTruthy()
  })

  it('blocks private network targets by default', async () => {
    const response = await app.request('/api/feed/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:8787/api/health' }),
    })
    expect(response.status).toBe(400)
    const data = (await response.json()) as { code: string }
    expect(data.code).toBe('private_address')
  })
})
