import { Hono } from 'hono'
import {
  buildSummaryMessages,
  buildTranslateMessages,
  type AiConfig,
  type SummaryRequest,
  type TranslateRequest,
} from '@flowread/shared'
import { assertAiConfig, completeOnce, listAiModels, streamChat } from '../lib/ai'
import { sseResponse } from '../lib/sse'

const MAX_TOKENS: Record<SummaryRequest['mode'], number> = {
  tldr: 400,
  'key-points': 900,
  detailed: 1800,
}

export function createAiRoutes(): Hono {
  const app = new Hono()

  app.post('/summarize', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      request?: SummaryRequest
      ai?: AiConfig
      proxy?: string
    }
    const request = body.request
    if (!request || typeof request.content !== 'string' || !request.content.trim()) {
      return c.json({ error: '缺少文章正文', code: 'missing_content' }, 400)
    }
    if (!['tldr', 'key-points', 'detailed'].includes(request.mode)) {
      return c.json({ error: '不支持的摘要模式', code: 'invalid_mode' }, 400)
    }
    let config: AiConfig
    try {
      config = assertAiConfig(body.ai)
    } catch (error) {
      return c.json({ error: (error as Error).message, code: 'invalid_ai_config' }, 400)
    }

    const messages = buildSummaryMessages({
      ...request,
      language: request.language || 'auto',
      title: request.title || '无标题',
    })

    return sseResponse(async (emit) => {
      await streamChat({
        config,
        messages,
        maxTokens: MAX_TOKENS[request.mode],
        signal: c.req.raw.signal,
        proxy: body.proxy,
        onDelta: (text) => emit('delta', { text }),
      })
      emit('complete', { mode: request.mode, model: config.model })
    })
  })

  app.post('/translate', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      request?: TranslateRequest
      ai?: AiConfig
      proxy?: string
    }
    const request = body.request
    if (!request || !Array.isArray(request.blocks) || request.blocks.length === 0) {
      return c.json({ error: '缺少要翻译的段落', code: 'missing_blocks' }, 400)
    }
    if (request.blocks.length > 80) {
      return c.json({ error: '单次翻译段落过多，请分批请求', code: 'too_many_blocks' }, 400)
    }
    const totalChars = request.blocks.reduce((sum, block) => sum + (block.text?.length ?? 0), 0)
    if (totalChars > 8000) {
      return c.json({ error: '单次翻译文本过长，请分批请求', code: 'too_long' }, 400)
    }
    let config: AiConfig
    try {
      config = assertAiConfig(body.ai)
    } catch (error) {
      return c.json({ error: (error as Error).message, code: 'invalid_ai_config' }, 400)
    }

    const messages = buildTranslateMessages({
      blocks: request.blocks.map((block) => ({ index: Number(block.index), text: String(block.text ?? '') })),
      targetLanguage: request.targetLanguage || 'zh-CN',
      ...(request.title ? { title: request.title } : {}),
    })

    return sseResponse(async (emit) => {
      await streamChat({
        config,
        messages,
        maxTokens: Math.min(4096, Math.max(512, Math.ceil(totalChars * 1.6))),
        signal: c.req.raw.signal,
        proxy: body.proxy,
        onDelta: (text) => emit('delta', { text }),
      })
      emit('complete', { model: config.model })
    })
  })

  app.post('/models', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ai?: AiConfig; proxy?: string }
    let config: AiConfig
    try {
      config = assertAiConfig(body.ai)
    } catch (error) {
      return c.json({ error: (error as Error).message, code: 'invalid_ai_config' }, 400)
    }
    try {
      const models = await listAiModels(config, body.proxy)
      return c.json({ models })
    } catch (error) {
      return c.json({ error: (error as Error).message, code: 'models_failed' }, 502)
    }
  })

  app.post('/test', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ai?: AiConfig; proxy?: string }
    let config: AiConfig
    try {
      config = assertAiConfig(body.ai)
    } catch (error) {
      return c.json({ ok: false, error: (error as Error).message }, 400)
    }
    try {
      const reply = await completeOnce(
        config,
        [
          { role: 'system', content: '你是一个连通性测试接口。' },
          { role: 'user', content: '只回复两个字：正常' },
        ],
        16,
        body.proxy,
      )
      return c.json({ ok: true, reply: reply.trim().slice(0, 80) })
    } catch (error) {
      return c.json({ ok: false, error: (error as Error).message }, 502)
    }
  })

  return app
}
