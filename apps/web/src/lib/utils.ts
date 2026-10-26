import DOMPurify from 'dompurify'
import { clsx, type ClassValue } from 'clsx'
import { isTauri } from './platform'

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}

export function uid(): string {
  try {
    return crypto.randomUUID().slice(0, 8)
  } catch {
    return Math.random().toString(36).slice(2, 10)
  }
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, wait = 300): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Args) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}

/* -------------------------------------------------------------------------- */
/* API helpers                                                                */
/* -------------------------------------------------------------------------- */

export function apiUrl(path: string, apiBase = '', params?: Record<string, string>): string {
  const base = apiBase.replace(/\/+$/, '')
  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  return `${base}${path}${query}`
}

export function imageProxyUrl(url: string, apiBase = ''): string {
  // Tauri loads images directly from the network; only the web build needs the
  // server-side proxy to deal with hotlink protection and CORS.
  if (isTauri()) return url
  return apiUrl('/api/image', apiBase, { url })
}

export function iconUrlFor(siteUrl: string | undefined, fallbackIcon: string | undefined, apiBase = ''): string | undefined {
  if (fallbackIcon) return fallbackIcon
  if (!siteUrl) return undefined
  if (isTauri()) {
    try {
      return new URL('/favicon.ico', siteUrl).toString()
    } catch {
      return undefined
    }
  }
  return apiUrl('/api/icon', apiBase, { url: siteUrl })
}

/* -------------------------------------------------------------------------- */
/* Article HTML                                                               */
/* -------------------------------------------------------------------------- */

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td'

export interface PreparedHtml {
  html: string
  blocks: { index: number; text: string }[]
}

export function sanitizeArticleHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel', 'loading', 'srcset', 'sizes', 'data-bi'],
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'link', 'meta'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
  })
}

/**
 * Sanitise article HTML and tag readable text blocks with `data-bi` so the
 * translation layer can map streamed translations back into the document.
 */
export function prepareArticleHtml(rawHtml: string): PreparedHtml {
  const clean = sanitizeArticleHtml(rawHtml)
  if (!clean) return { html: '', blocks: [] }
  const doc = new DOMParser().parseFromString(`<div id="flowread-root">${clean}</div>`, 'text/html')
  const root = doc.getElementById('flowread-root')
  if (!root) return { html: clean, blocks: [] }
  const blocks: { index: number; text: string }[] = []
  let index = 0
  root.querySelectorAll(BLOCK_SELECTOR).forEach((element) => {
    if (element.closest('pre, code, figure > figcaption')) return
    if (element.tagName === 'LI' && element.querySelector('p, ul, ol')) return
    if (element.tagName === 'BLOCKQUOTE' && element.querySelector('p, li')) return
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text.length < 2 || text.length > 3000) return
    element.setAttribute('data-bi', String(index))
    blocks.push({ index, text })
    index += 1
  })
  return { html: root.innerHTML, blocks }
}

function ensureOriginalWrapper(element: HTMLElement): HTMLElement {
  const existing = element.querySelector<HTMLElement>(':scope > .flowread-original')
  if (existing) return existing
  const wrapper = document.createElement('span')
  wrapper.className = 'flowread-original'
  const keepOutside = new Set(['IMG', 'VIDEO', 'IFRAME', 'AUDIO', 'PICTURE', 'FIGURE', 'TABLE', 'PRE', 'BUTTON'])
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && keepOutside.has((node as Element).tagName)) continue
    wrapper.appendChild(node)
  }
  element.insertBefore(wrapper, element.firstChild)
  return wrapper
}

function unwrapOriginal(element: HTMLElement): void {
  const wrapper = element.querySelector<HTMLElement>(':scope > .flowread-original')
  if (!wrapper) return
  const parent = wrapper.parentNode
  if (!parent) return
  while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper)
  wrapper.remove()
}

/** Render (or update) translations inside a prepared article container. */
export function applyTranslations(
  container: HTMLElement,
  translations: Record<string, string> | undefined,
  mode: 'bilingual' | 'translated',
): void {
  container.dataset.translationMode = mode
  container.querySelectorAll<HTMLElement>('[data-bi]').forEach((element) => {
    const key = element.getAttribute('data-bi') ?? ''
    const text = translations?.[key]
    element.querySelectorAll(':scope > .flowread-translation').forEach((node) => node.remove())
    if (!text) {
      unwrapOriginal(element)
      return
    }
    if (mode === 'translated') ensureOriginalWrapper(element)
    else unwrapOriginal(element)
    const span = document.createElement('span')
    span.className = 'flowread-translation'
    span.textContent = text
    element.appendChild(span)
  })
}

/** Approximate reading time in minutes for mixed CJK / Latin text. */
export function readingMinutes(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length
  const words = text.replace(/[\u3400-\u9fff]/g, ' ').split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(cjk / 400 + words / 220))
}

export function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatRelativeTime(timestamp: number | undefined, locale: string, now = Date.now()): string {
  if (!timestamp) return ''
  const diff = now - timestamp
  const formatter = new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', { numeric: 'auto' })
  if (diff < MINUTE) return locale === 'zh' ? '刚刚' : 'just now'
  if (diff < HOUR) return formatter.format(-Math.floor(diff / MINUTE), 'minute')
  if (diff < DAY && new Date(timestamp).getDate() === new Date(now).getDate()) {
    return formatter.format(-Math.floor(diff / HOUR), 'hour')
  }
  if (diff < 7 * DAY) return formatter.format(-Math.floor(diff / DAY), 'day')
  return formatDate(timestamp, locale)
}

export function formatDate(timestamp: number | undefined, locale: string): string {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp))
}

export function formatFullDate(timestamp: number | undefined, locale: string): string {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export type DateGroup = 'today' | 'yesterday' | 'week' | 'earlier' | 'undated'

export function dateGroupOf(timestamp: number | undefined, now = Date.now()): DateGroup {
  if (!timestamp) return 'undated'
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  if (timestamp >= startOfToday.getTime()) return 'today'
  if (timestamp >= startOfToday.getTime() - DAY) return 'yesterday'
  if (timestamp >= startOfToday.getTime() - 6 * DAY) return 'week'
  return 'earlier'
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

export function downloadBlob(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  }
}

export function hostnameOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function hueFromString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) | 0
  return Math.abs(hash) % 360
}

export function chunkBy<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}
