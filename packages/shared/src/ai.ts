import type { SummaryMode, SummaryRequest, TranslateRequest } from './types'
import { truncate } from './utils'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export const SUMMARY_MAX_CHARS = 16_000
export const TRANSLATE_MAX_CHARS = 4_000

const LANGUAGE_NAMES: Record<string, string> = {
  auto: '与原文相同的语言',
  zh: '简体中文',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
}

export function resolveLanguageName(code: string | undefined): string {
  if (!code) return LANGUAGE_NAMES.auto!
  return LANGUAGE_NAMES[code] ?? code
}

const MODE_INSTRUCTIONS: Record<SummaryMode, string> = {
  tldr: [
    '只输出 1–3 句话的极简摘要，直接给结论。',
    '不要标题，不要列表，不要任何前后缀说明。',
    '语言精炼、信息密度高，保留最关键的数字或结论。',
  ].join('\n'),
  'key-points': [
    '输出 3–7 条要点，使用 Markdown 无序列表（每条以 "- " 开头）。',
    '每条一行，20–40 字，说明事实、数据或结论，不要空泛套话。',
    '如果是技术/教程类文章，请包含方法、工具名或代码要点。',
  ].join('\n'),
  detailed: [
    '输出结构化 Markdown，严格按以下结构：',
    '> 一句话总结（blockquote，不超过 60 字）',
    '',
    '## 核心观点',
    '2–4 条要点列表。',
    '',
    '## 关键细节',
    '1–2 段连贯的说明，包含文中出现的关键数据、人物、产品、时间。',
    '',
    '## 值得关注',
    '1–3 条读者应该进一步行动或思考的点；如果原文没有，请写"无"。',
  ].join('\n'),
}

export function buildSummaryMessages(request: SummaryRequest): ChatMessage[] {
  const language = resolveLanguageName(request.language)
  const content = truncate(request.content.replace(/\s+\n/g, '\n').trim(), SUMMARY_MAX_CHARS)
  const system = [
    '你是一名资深编辑，擅长把长文章压缩成准确、克制的摘要。',
    '规则：',
    '1. 只使用原文中出现的信息，绝不编造，也不要把你的背景知识当作原文内容。',
    '2. 保留原文的关键数据、人名、产品名、版本号和结论。',
    '3. 如果原文是评论，请区分"作者观点"与"事实"。',
    `4. 使用${language}输出。`,
    '5. 直接输出最终结果，不要写"好的"、"以下是摘要"之类的话。',
  ].join('\n')

  const user = [
    `文章标题：${request.title || '（无标题）'}`,
    request.url ? `文章链接：${request.url}` : '',
    '',
    '摘要要求：',
    MODE_INSTRUCTIONS[request.mode],
    '',
    '文章正文：',
    '"""',
    content,
    '"""',
  ]
    .filter((line) => line !== '')
    .join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/**
 * Translation is done in numbered blocks so the client can stream partial
 * results and re-assemble them into the original DOM.
 */
export function buildTranslateMessages(request: TranslateRequest): ChatMessage[] {
  const target = resolveLanguageName(request.targetLanguage)
  const system = [
    `你是一名专业翻译，负责把文本翻译成${target}。`,
    '规则：',
    '1. 忠实、通顺、符合目标语言的表达习惯，不要逐字硬译。',
    '2. 保留数字、代码、URL、专有名词和产品名；必要时可在括号内附原文。',
    '3. 输入每行格式为 "[序号] 原文"。',
    '4. 输出必须与输入行数完全一致，每行格式为 "序号||译文"，不要输出任何其他内容。',
    '5. 不要合并或拆分句子，不要添加解释、标题或空行。',
  ].join('\n')

  const blocks = request.blocks.map((block) => `[${block.index}] ${block.text}`).join('\n')
  const user = [
    request.title ? `文章标题（仅供术语参考，不要翻译此行）：${truncate(request.title, 200)}` : '',
    '',
    blocks,
  ]
    .filter(Boolean)
    .join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** Parse the model list returned by OpenAI-compatible `/models` endpoints. */
export function parseOpenAiModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const record = payload as { data?: unknown; models?: unknown }
  const list = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : []
  const ids = new Set<string>()
  for (const entry of list) {
    if (typeof entry === 'string') {
      ids.add(entry)
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const item = entry as { id?: unknown; name?: unknown; model?: unknown }
    const value = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : item.model
    if (typeof value === 'string' && value.trim()) ids.add(value.trim())
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

/** Parse one streamed translation line (`12||译文` or `[12] 译文`). */
export function parseTranslationLine(line: string): { index: number; text: string } | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const bracketed = /^\[(-?\d+)\]\s*\|{0,2}\s*([\s\S]*)$/.exec(trimmed)
  if (bracketed) {
    return { index: Number.parseInt(bracketed[1]!, 10), text: bracketed[2]!.trim() }
  }
  const piped = /^(-?\d+)\s*(?:\|\||:|\||：)\s*([\s\S]*)$/.exec(trimmed)
  if (piped) {
    return { index: Number.parseInt(piped[1]!, 10), text: piped[2]!.trim() }
  }
  return null
}
