/**
 * Cross-platform domain types shared by the web client, the API server and the
 * desktop shell.
 */

export type FeedFormat = 'rss' | 'atom' | 'json'

export interface FeedEnclosure {
  url: string
  type?: string
  length?: number
}

export interface ParsedItem {
  /** Stable identifier inside the feed (guid / atom id / permalink). */
  guid: string
  title: string
  link: string
  /** Plain-text excerpt used in list views. */
  summary: string
  /** Raw HTML body from the feed (may be a truncated summary). */
  contentHtml: string
  author?: string
  /** Publication time as epoch milliseconds. */
  publishedAt?: number
  imageUrl?: string
  categories: string[]
  enclosures: FeedEnclosure[]
  audioUrl?: string
  duration?: number
}

export interface ParsedFeed {
  url: string
  title: string
  siteUrl?: string
  description?: string
  iconUrl?: string
  language?: string
  format: FeedFormat
  items: ParsedItem[]
}

export interface ExtractedArticle {
  url: string
  title?: string
  byline?: string
  siteName?: string
  excerpt?: string
  html: string
  textLength: number
  imageUrl?: string
}

export type AiProvider = 'deepseek' | 'openai' | 'siliconflow' | 'ollama' | 'custom'

export interface AiConfig {
  provider: AiProvider
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
}

export interface AiPreset {
  id: AiProvider
  label: string
  baseUrl: string
  model: string
  requiresKey: boolean
}

export const AI_PRESETS: AiPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    requiresKey: true,
  },
  // {
  //   id: 'openai',
  //   label: 'OpenAI',
  //   baseUrl: 'https://api.openai.com/v1',
  //   model: 'gpt-4o-mini',
  //   requiresKey: true,
  // },
  // {
  //   id: 'siliconflow',
  //   label: 'SiliconFlow',
  //   baseUrl: 'https://api.siliconflow.cn/v1',
  //   model: 'Qwen/Qwen2.5-7B-Instruct',
  //   requiresKey: true,
  // },
  // {
  //   id: 'ollama',
  //   label: 'Ollama (本地)',
  //   baseUrl: 'http://127.0.0.1:11434/v1',
  //   model: 'qwen2.5:7b',
  //   requiresKey: false,
  // },
  // {
  //   id: 'custom',
  //   label: '自定义 (OpenAI 兼容)',
  //   baseUrl: '',
  //   model: '',
  //   requiresKey: false,
  // },
]

export type SummaryMode = 'tldr' | 'key-points' | 'detailed'

export interface SummaryRequest {
  title: string
  content: string
  mode: SummaryMode
  /** Output language, e.g. "中文" / "English"; `auto` mirrors the article. */
  language: string
  url?: string
}

export interface TranslateRequest {
  /** Text blocks keyed by index – the model returns `index||translation` lines. */
  blocks: { index: number; text: string }[]
  targetLanguage: string
  /** Optional title of the article for terminology context. */
  title?: string
}

export interface FeedDiscoveryResult {
  candidates: {
    url: string
    title?: string
    type: FeedFormat
  }[]
  siteUrl: string
  title?: string
}

export interface OpmlFeed {
  title: string
  xmlUrl: string
  htmlUrl?: string
  folder?: string
}

export interface OpmlDocument {
  title: string
  feeds: OpmlFeed[]
  folders: string[]
}
