import type { AiConfig } from '@flowread/shared'
import type { ChatMessage } from '@flowread/shared'
import { parseOpenAiModelIds } from '@flowread/shared'
import { fetch as undiciFetch } from 'undici'
import { proxyDispatcher } from './fetcher'

const proxyFetch = undiciFetch as unknown as typeof fetch

export class AiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly code = 'ai_failed',
  ) {
    super(message)
    this.name = 'AiError'
  }
}

function endpointOf(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

function modelsEndpointOf(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/models$/i.test(trimmed)) return trimmed
  return `${trimmed}/models`
}

export function assertAiConfig(config: Partial<AiConfig> | undefined): AiConfig {
  if (!config || typeof config !== 'object') throw new AiError('缺少 AI 配置', 400, 'invalid_ai_config')
  const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl.trim() : ''
  const model = typeof config.model === 'string' ? config.model.trim() : ''
  if (!/^https?:\/\//i.test(baseUrl)) throw new AiError('AI 接口地址无效（需要以 http(s):// 开头）', 400, 'invalid_ai_config')
  if (!model) throw new AiError('未配置 AI 模型名称', 400, 'invalid_ai_config')
  const provider = (config.provider ?? 'custom') as AiConfig['provider']
  if ((provider === 'deepseek' || provider === 'openai' || provider === 'siliconflow') && !config.apiKey) {
    throw new AiError('该服务商需要 API Key', 400, 'missing_api_key')
  }
  return {
    provider,
    baseUrl,
    model,
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
    ...(typeof config.temperature === 'number' ? { temperature: config.temperature } : {}),
  }
}

interface StreamOptions {
  config: AiConfig
  messages: ChatMessage[]
  maxTokens?: number
  signal?: AbortSignal
  proxy?: string
  onDelta: (text: string) => void
}

async function readErrorBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  try {
    const data = JSON.parse(text) as { error?: { message?: string }; message?: string }
    return data.error?.message ?? data.message ?? text.slice(0, 300)
  } catch {
    return text.slice(0, 300)
  }
}

function extractDelta(payload: string): string {
  try {
    const data = JSON.parse(payload) as {
      choices?: { delta?: { content?: string | null }; message?: { content?: string } }[]
      error?: { message?: string }
    }
    if (data.error?.message) throw new AiError(data.error.message, 502, 'upstream_ai_error')
    const choice = data.choices?.[0]
    return choice?.delta?.content ?? choice?.message?.content ?? ''
  } catch (error) {
    if (error instanceof AiError) throw error
    return ''
  }
}

/** Stream an OpenAI-compatible chat completion, invoking `onDelta` per token chunk. */
export async function streamChat(options: StreamOptions): Promise<void> {
  const { config, messages, onDelta } = options
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onAbort)

  const timeout = setTimeout(() => controller.abort(), 180_000)
  const dispatcher = proxyDispatcher(options.proxy)
  try {
    const response = await (dispatcher ? proxyFetch : fetch)(endpointOf(config.baseUrl), {
      method: 'POST',
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        ...(typeof options.maxTokens === 'number' ? { max_tokens: options.maxTokens } : {}),
        ...(typeof config.temperature === 'number' ? { temperature: config.temperature } : {}),
      }),
    })

    if (!response.ok) {
      const detail = await readErrorBody(response)
      throw new AiError(`AI 服务返回 ${response.status}：${detail || '未知错误'}`, 502, 'upstream_ai_error')
    }
    if (!response.body) throw new AiError('AI 服务没有返回内容', 502, 'empty_response')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        const delta = extractDelta(payload)
        if (delta) onDelta(delta)
      }
    }
  } catch (error) {
    if (error instanceof AiError) throw error
    if ((error as Error).name === 'AbortError') throw new AiError('请求已取消或超时', 499, 'aborted')
    throw new AiError(`无法连接 AI 服务：${(error as Error).message}`, 502, 'ai_network')
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/** Fetch the list of models exposed by an OpenAI-compatible provider. */
export async function listAiModels(config: AiConfig, proxy?: string): Promise<string[]> {
  try {
    const dispatcher = proxyDispatcher(proxy)
    const response = await (dispatcher ? proxyFetch : fetch)(modelsEndpointOf(config.baseUrl), {
      ...(dispatcher ? { dispatcher } : {}),
      headers: {
        accept: 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      const detail = await readErrorBody(response)
      throw new AiError(`AI 服务返回 ${response.status}：${detail || '未知错误'}`, 502, 'upstream_ai_error')
    }
    const payload = (await response.json()) as unknown
    const models = parseOpenAiModelIds(payload)
    if (models.length === 0) throw new AiError('AI 服务没有返回可用模型', 502, 'no_models')
    return models
  } catch (error) {
    if (error instanceof AiError) throw error
    if ((error as Error).name === 'AbortError' || (error as Error).name === 'TimeoutError') {
      throw new AiError('获取模型超时', 504, 'timeout')
    }
    throw new AiError(`无法获取模型列表：${(error as Error).message}`, 502, 'ai_network')
  }
}

/** Single non-streaming completion – used by the settings connection test. */
export async function completeOnce(
  config: AiConfig,
  messages: ChatMessage[],
  maxTokens = 32,
  proxy?: string,
): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  const dispatcher = proxyDispatcher(proxy)
  try {
    const response = await (dispatcher ? proxyFetch : fetch)(endpointOf(config.baseUrl), {
      method: 'POST',
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: config.model, messages, stream: false, max_tokens: maxTokens }),
    })
    if (!response.ok) {
      const detail = await readErrorBody(response)
      throw new AiError(`AI 服务返回 ${response.status}：${detail || '未知错误'}`, 502, 'upstream_ai_error')
    }
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content ?? ''
  } catch (error) {
    if (error instanceof AiError) throw error
    if ((error as Error).name === 'AbortError') throw new AiError('连接超时', 504, 'timeout')
    throw new AiError(`无法连接 AI 服务：${(error as Error).message}`, 502, 'ai_network')
  } finally {
    clearTimeout(timeout)
  }
}
