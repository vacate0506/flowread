import {
  buildSummaryMessages,
  buildTranslateMessages,
  looksLikeFeedPayload,
  normalizeUrl,
  parseFeedDocument,
  parseOpenAiModelIds,
  type AiConfig,
  type ChatMessage,
  type ExtractedArticle,
  type FeedDiscoveryResult,
  type ParsedFeed,
  type SummaryRequest,
  type TranslateRequest,
} from '@flowread/shared'
import { apiUrl } from './utils'
import { isTauri, tauriInvoke } from './platform'
import { discoverFeedsFromHtml, extractArticleFromHtml } from './extractClient'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code = 'error',
    readonly status = 0,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  apiBase: string
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions): Promise<T> {
  let response: Response
  try {
    response = await fetch(apiUrl(path, options.apiBase), {
      method: options.method ?? 'GET',
      headers: options.body ? { 'content-type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new ApiError('无法连接 FlowRead 服务，请检查网络或在设置中修改服务地址。', 'network_error')
  }
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { error: text.slice(0, 200) }
    }
  }
  const payload = (data ?? {}) as { error?: string; code?: string }
  if (!response.ok) {
    throw new ApiError(payload.error ?? `请求失败（HTTP ${response.status}）`, payload.code ?? 'http_error', response.status)
  }
  return data as T
}

export interface FetchFeedResult {
  feed?: ParsedFeed
  feedUrl?: string
  notModified?: boolean
  etag?: string
  lastModified?: string
  error?: string
}

/* -------------------------------------------------------------------------- */
/* Tauri transport (no Node server on the desktop)                            */
/* -------------------------------------------------------------------------- */

interface TauriFetchResponse {
  status: number
  url: string
  headers: Record<string, string>
  body: string
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value || undefined
  }
  return undefined
}

async function tauriFetchText(
  url: string,
  headers: Record<string, string> = {},
  proxy?: string,
): Promise<TauriFetchResponse> {
  try {
    return await tauriInvoke<TauriFetchResponse>('fetch_text', {
      url,
      headers,
      proxy: proxy ?? null,
    })
  } catch (error) {
    throw new ApiError(typeof error === 'string' ? error : `无法访问该地址：${String(error)}`, 'fetch_failed')
  }
}

function isHtmlPayload(contentType: string, body: string): boolean {
  const head = body.replace(/^\uFEFF/, '').trimStart().slice(0, 200).toLowerCase()
  return /html/i.test(contentType) || head.startsWith('<!doctype') || head.startsWith('<html')
}

function isFeedPayload(contentType: string, body: string): boolean {
  return looksLikeFeedPayload(contentType, body) && !isHtmlPayload(contentType, body)
}

async function fetchFeedLocal(
  url: string,
  options: { etag?: string; lastModified?: string; autoDiscover?: boolean; proxy?: string },
): Promise<FetchFeedResult> {
  const target = normalizeUrl(url)
  if (!target) throw new ApiError('请提供订阅链接', 'missing_url', 400)
  const headers: Record<string, string> = {}
  if (options.etag) headers['if-none-match'] = options.etag
  if (options.lastModified) headers['if-modified-since'] = options.lastModified

  const first = await tauriFetchText(target, headers, options.proxy)
  if (first.status === 304) {
    return {
      notModified: true,
      ...(headerValue(first.headers, 'etag') ? { etag: headerValue(first.headers, 'etag') } : {}),
      ...(headerValue(first.headers, 'last-modified')
        ? { lastModified: headerValue(first.headers, 'last-modified') }
        : {}),
    }
  }
  if (first.status >= 400) {
    throw new ApiError(`远端返回 HTTP ${first.status}`, 'upstream_error', first.status)
  }

  const contentType = headerValue(first.headers, 'content-type') ?? ''
  let feed: ParsedFeed
  let feedUrl = first.url

  if (isFeedPayload(contentType, first.body) || options.autoDiscover === false) {
    feed = parseFeedDocument(first.body, first.url)
  } else {
    const discovery = discoverFeedsFromHtml(first.body, first.url)
    const candidate = discovery.candidates[0]
    if (!candidate) {
      throw new ApiError(
        '这个页面里没有找到 RSS/Atom 订阅源，请直接填写订阅链接（通常以 .xml 或 /feed 结尾）。',
        'no_feed_found',
        422,
      )
    }
    const second = await tauriFetchText(candidate.url, {}, options.proxy)
    feed = parseFeedDocument(second.body, second.url)
    feedUrl = second.url
  }

  if (!feed.title) feed.title = new URL(feedUrl).hostname
  if (!feed.siteUrl) feed.siteUrl = new URL(feedUrl).origin
  const etag = headerValue(first.headers, 'etag')
  const lastModified = headerValue(first.headers, 'last-modified')
  return {
    feed,
    feedUrl,
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
  }
}

async function discoverFeedsLocal(url: string, proxy?: string): Promise<FeedDiscoveryResult> {
  const target = normalizeUrl(url)
  if (!target) throw new ApiError('请提供网址', 'missing_url', 400)
  const result = await tauriFetchText(target, {}, proxy)
  const contentType = headerValue(result.headers, 'content-type') ?? ''
  if (isFeedPayload(contentType, result.body)) {
    const feed = parseFeedDocument(result.body, result.url)
    return {
      siteUrl: feed.siteUrl ?? new URL(result.url).origin,
      ...(feed.title ? { title: feed.title } : {}),
      candidates: [{ url: result.url, title: feed.title, type: feed.format }],
    }
  }
  return discoverFeedsFromHtml(result.body, result.url)
}

async function extractArticleLocal(url: string, proxy?: string): Promise<ExtractedArticle> {
  const target = normalizeUrl(url)
  const result = await tauriFetchText(target, {}, proxy)
  const article = extractArticleFromHtml(result.body, result.url)
  if (article.textLength < 120) {
    throw new ApiError('未能从该页面提取到正文，可能需要在原站阅读。', 'no_content', 422)
  }
  return article
}

/* -------------------------------------------------------------------------- */
/* Local AI (OpenAI-compatible, streamed through a Tauri channel)             */
/* -------------------------------------------------------------------------- */

const SUMMARY_MAX_TOKENS: Record<SummaryRequest['mode'], number> = {
  tldr: 400,
  'key-points': 900,
  detailed: 1800,
}

function aiEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

function aiModelsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/models$/i.test(trimmed)) return trimmed
  return `${trimmed}/models`
}

function aiHeaders(ai: AiConfig): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(ai.apiKey ? { authorization: `Bearer ${ai.apiKey}` } : {}),
  }
}

async function readOpenAiStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let data: {
          choices?: { delta?: { content?: string | null } }[]
          error?: { message?: string }
        }
        try {
          data = JSON.parse(payload) as typeof data
        } catch {
          continue
        }
        if (data.error?.message) throw new ApiError(data.error.message, 'upstream_ai_error')
        const delta = data.choices?.[0]?.delta?.content
        if (delta) onDelta(delta)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function streamLocalAi(
  ai: AiConfig,
  messages: ChatMessage[],
  maxTokens: number,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  proxy?: string,
): Promise<void> {
  const { Channel } = await import('@tauri-apps/api/core')
  const channel = new Channel<string>()
  const id = crypto.randomUUID()
  let closed = false
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = (): void => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      const fail = (error: unknown): void => {
        if (closed) return
        closed = true
        try {
          controller.error(error instanceof Error ? error : new ApiError(String(error), 'ai_request_failed'))
        } catch {
          /* already closed */
        }
      }
      channel.onmessage = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk))
      }
      tauriInvoke('ai_stream', {
        request: {
          id,
          url: aiEndpoint(ai.baseUrl),
          headers: aiHeaders(ai),
          body: JSON.stringify({
            model: ai.model,
            messages,
            stream: true,
            max_tokens: maxTokens,
            ...(typeof ai.temperature === 'number' ? { temperature: ai.temperature } : {}),
          }),
          proxy: proxy ?? null,
        },
        onEvent: channel,
      })
        .then(close)
        .catch(fail)
    },
    cancel() {
      closed = true
      void tauriInvoke('ai_cancel', { id }).catch(() => undefined)
    },
  })

  const onAbort = (): void => {
    void tauriInvoke('ai_cancel', { id }).catch(() => undefined)
    void stream.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort)
  try {
    await readOpenAiStream(stream, onDelta, signal)
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

async function testAiLocal(
  ai: AiConfig,
  proxy?: string,
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  try {
    const raw = await tauriInvoke<string>('ai_complete', {
      url: aiEndpoint(ai.baseUrl),
      headers: aiHeaders(ai),
      proxy: proxy ?? null,
      body: JSON.stringify({
        model: ai.model,
        messages: [
          { role: 'system', content: '你是一个连通性测试接口。' },
          { role: 'user', content: '只回复两个字：正常' },
        ],
        stream: false,
        max_tokens: 16,
      }),
    })
    const data = JSON.parse(raw) as { choices?: { message?: { content?: string } }[] }
    return { ok: true, reply: (data.choices?.[0]?.message?.content ?? '').slice(0, 80) }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export async function fetchFeed(
  url: string,
  apiBase: string,
  options: {
    etag?: string
    lastModified?: string
    signal?: AbortSignal
    autoDiscover?: boolean
    proxy?: string
  } = {},
): Promise<FetchFeedResult> {
  if (isTauri()) return fetchFeedLocal(url, options)
  return request<FetchFeedResult>('/api/feed/fetch', {
    method: 'POST',
    body: {
      url,
      ...(options.etag ? { etag: options.etag } : {}),
      ...(options.lastModified ? { lastModified: options.lastModified } : {}),
      ...(options.autoDiscover === false ? { autoDiscover: false } : {}),
      ...(options.proxy ? { proxy: options.proxy } : {}),
    },
    apiBase,
    signal: options.signal,
  })
}

export async function discoverFeeds(
  url: string,
  apiBase: string,
  proxy?: string,
): Promise<FeedDiscoveryResult> {
  if (isTauri()) return discoverFeedsLocal(url, proxy)
  return request<FeedDiscoveryResult>('/api/feed/discover', {
    method: 'POST',
    body: { url, ...(proxy ? { proxy } : {}) },
    apiBase,
  })
}

export async function extractArticle(
  url: string,
  apiBase: string,
  proxy?: string,
): Promise<ExtractedArticle> {
  if (isTauri()) return extractArticleLocal(url, proxy)
  const result = await request<{ article: ExtractedArticle }>('/api/article/extract', {
    method: 'POST',
    body: { url, ...(proxy ? { proxy } : {}) },
    apiBase,
  })
  return result.article
}

export async function testAi(
  ai: unknown,
  apiBase: string,
  proxy?: string,
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  if (isTauri()) return testAiLocal(ai as AiConfig, proxy)
  const response = await fetch(apiUrl('/api/ai/test', apiBase), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ai, ...(proxy ? { proxy } : {}) }),
  })
  return (await response.json()) as { ok: boolean; reply?: string; error?: string }
}

/** Load the model list from the configured provider's /models endpoint. */
export async function fetchAiModels(ai: AiConfig, apiBase: string, proxy?: string): Promise<string[]> {
  if (isTauri()) {
    let raw: string
    try {
      raw = await tauriInvoke<string>('ai_models', {
        url: aiModelsEndpoint(ai.baseUrl),
        headers: aiHeaders(ai),
        proxy: proxy ?? null,
      })
    } catch (error) {
      throw new ApiError(typeof error === 'string' ? error : `获取模型失败：${String(error)}`, 'models_failed')
    }
    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      throw new ApiError('AI 服务返回了无法解析的模型列表', 'models_failed')
    }
    const models = parseOpenAiModelIds(payload)
    if (models.length === 0) throw new ApiError('AI 服务没有返回可用模型', 'no_models')
    return models
  }

  const result = await request<{ models: string[] }>('/api/ai/models', {
    method: 'POST',
    body: { ai, ...(proxy ? { proxy } : {}) },
    apiBase,
  })
  return result.models
}

async function readSse(
  response: Response,
  onEvent: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new ApiError('服务没有返回流式内容', 'empty_stream')
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const chunk = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const lines = chunk.split('\n')
        let event = 'message'
        const dataLines: string[] = []
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        }
        if (dataLines.length > 0) {
          let data: Record<string, unknown>
          try {
            data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>
          } catch {
            boundary = buffer.indexOf('\n\n')
            continue
          }
          onEvent(event, data)
        }
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function throwSseError(response: Response): Promise<never> {
  const text = await response.text().catch(() => '')
  let message = `AI 请求失败（HTTP ${response.status}）`
  try {
    const data = JSON.parse(text) as { error?: string }
    if (data.error) message = data.error
  } catch {
    if (text) message = text.slice(0, 200)
  }
  throw new ApiError(message, 'ai_request_failed', response.status)
}

export interface StreamAiOptions {
  apiBase: string
  ai: unknown
  proxy?: string
  signal?: AbortSignal
  onDelta: (text: string) => void
}

export async function summarizeStream(requestBody: unknown, options: StreamAiOptions): Promise<void> {
  const request = requestBody as SummaryRequest
  if (isTauri()) {
    const messages = buildSummaryMessages({
      ...request,
      language: request.language || 'auto',
      title: request.title || '无标题',
    })
    await streamLocalAi(
      options.ai as AiConfig,
      messages,
      SUMMARY_MAX_TOKENS[request.mode] ?? 1200,
      options.onDelta,
      options.signal,
      options.proxy,
    )
    return
  }

  const response = await fetch(apiUrl('/api/ai/summarize', options.apiBase), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      request: requestBody,
      ai: options.ai,
      ...(options.proxy ? { proxy: options.proxy } : {}),
    }),
    signal: options.signal,
  })
  if (!response.ok) await throwSseError(response)
  await readSse(response, (event, data) => {
    if (event === 'delta' && typeof data.text === 'string') options.onDelta(data.text)
    if (event === 'error') throw new ApiError(String(data.message ?? 'AI 生成失败'), String(data.code ?? 'ai_error'))
  })
}

export async function translateStream(requestBody: unknown, options: StreamAiOptions): Promise<void> {
  if (isTauri()) {
    const request = requestBody as TranslateRequest
    const messages = buildTranslateMessages({
      blocks: request.blocks.map((block) => ({ index: Number(block.index), text: String(block.text ?? '') })),
      targetLanguage: request.targetLanguage || 'zh-CN',
      ...(request.title ? { title: request.title } : {}),
    })
    const totalChars = request.blocks.reduce((sum, block) => sum + (block.text?.length ?? 0), 0)
    await streamLocalAi(
      options.ai as AiConfig,
      messages,
      Math.min(4096, Math.max(512, Math.ceil(totalChars * 1.6))),
      options.onDelta,
      options.signal,
      options.proxy,
    )
    return
  }

  const response = await fetch(apiUrl('/api/ai/translate', options.apiBase), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      request: requestBody,
      ai: options.ai,
      ...(options.proxy ? { proxy: options.proxy } : {}),
    }),
    signal: options.signal,
  })
  if (!response.ok) await throwSseError(response)
  await readSse(response, (event, data) => {
    if (event === 'delta' && typeof data.text === 'string') options.onDelta(data.text)
    if (event === 'error') throw new ApiError(String(data.message ?? 'AI 翻译失败'), String(data.code ?? 'ai_error'))
  })
}
