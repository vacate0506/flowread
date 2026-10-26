import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici'

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly code = 'fetch_failed',
  ) {
    super(message)
    this.name = 'FetchError'
  }
}

export interface FetchOptions {
  timeoutMs?: number
  maxBytes?: number
  headers?: Record<string, string>
  accept?: string
  allowPrivateNetwork?: boolean
  proxy?: string
}

/** Only HTTP(S) proxies are supported; empty / invalid values are rejected. */
export function normalizeProxyUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (!url.hostname) return undefined
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

const proxyAgents = new Map<string, ProxyAgent>()
const proxyFetch = undiciFetch as unknown as typeof fetch

export function proxyDispatcher(proxy?: string): Dispatcher | undefined {
  if (!proxy?.trim()) return undefined
  const normalized = normalizeProxyUrl(proxy)
  if (!normalized) throw new FetchError('代理地址无效，需要以 http:// 或 https:// 开头', 400, 'invalid_proxy')
  let agent = proxyAgents.get(normalized)
  if (!agent) {
    agent = new ProxyAgent(normalized)
    proxyAgents.set(normalized, agent)
  }
  return agent
}

export interface FetchResult {
  status: number
  url: string
  contentType: string
  etag?: string
  lastModified?: string
  body: string
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 FlowRead/0.1 (+https://github.com/flowread)'

const MAX_BYTES = 10 * 1024 * 1024

function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) return null
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
}

function isPrivateIPv4(address: string): boolean {
  const value = ipv4ToNumber(address)
  if (value == null) return true
  const ranges: [string, number][] = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ]
  return ranges.some(([base, bits]) => {
    const baseValue = ipv4ToNumber(base)!
    const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0
    return (value & mask) === (baseValue & mask)
  })
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fe80') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (normalized.startsWith('::ffff:')) return isPrivateIPv4(normalized.slice(7))
  return false
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return isPrivateIPv4(address)
  if (version === 6) return isPrivateIPv6(address)
  return true
}

/** Block SSRF targets: only public http(s) endpoints may be fetched. */
async function assertSafeUrl(url: URL, allowPrivateNetwork: boolean): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchError('只支持 http/https 链接', 400, 'invalid_url')
  }
  if (allowPrivateNetwork) return
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
    throw new FetchError('出于安全考虑，默认禁止访问内网地址（可设置 ALLOW_PRIVATE_NETWORK=1）', 400, 'private_address')
  }
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true }).catch(() => {
        throw new FetchError(`无法解析域名 ${url.hostname}`, 400, 'dns_failed')
      })
  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) {
      throw new FetchError('出于安全考虑，默认禁止访问内网地址（可设置 ALLOW_PRIVATE_NETWORK=1）', 400, 'private_address')
    }
  }
}

function decodeBody(buffer: Uint8Array, contentType: string): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
  if (!charset) {
    const head = new TextDecoder('utf-8').decode(buffer.subarray(0, 2048))
    charset =
      /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
      /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(head)?.[1] ??
      undefined
  }
  try {
    return new TextDecoder(charset?.toLowerCase() ?? 'utf-8').decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(length) && length > maxBytes) {
    throw new FetchError('内容过大，已拒绝下载', 413, 'too_large')
  }
  const body = response.body
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new FetchError('内容过大，已拒绝下载', 413, 'too_large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

/** Fetch a remote document with timeout, size limit, SSRF protection and charset sniffing. */
export async function fetchDocument(target: string, options: FetchOptions = {}): Promise<FetchResult> {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    throw new FetchError('链接格式不正确', 400, 'invalid_url')
  }
  await assertSafeUrl(url, options.allowPrivateNetwork ?? false)

  const timeoutMs = options.timeoutMs ?? 20_000
  const dispatcher = proxyDispatcher(options.proxy)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await (dispatcher ? proxyFetch : fetch)(url, {
      redirect: 'follow',
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
      headers: {
        'user-agent': DEFAULT_UA,
        accept:
          options.accept ??
          'application/rss+xml, application/atom+xml, application/feed+json, application/json;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        ...options.headers,
      },
    } as RequestInit)

    if (!response.ok && response.status !== 304) {
      throw new FetchError(`远端返回 HTTP ${response.status}`, 502, 'upstream_error')
    }
    const contentType = response.headers.get('content-type') ?? ''
    const etag = response.headers.get('etag') ?? undefined
    const lastModified = response.headers.get('last-modified') ?? undefined
    if (response.status === 304) {
      return { status: 304, url: response.url || url.toString(), contentType, ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}), body: '' }
    }
    const buffer = await readLimited(response, options.maxBytes ?? MAX_BYTES)
    return {
      status: response.status,
      url: response.url || url.toString(),
      contentType,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
      body: decodeBody(buffer, contentType),
    }
  } catch (error) {
    if (error instanceof FetchError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new FetchError('请求超时，请稍后重试', 504, 'timeout')
    }
    throw new FetchError(`无法访问该地址：${(error as Error).message}`, 502, 'fetch_failed')
  } finally {
    clearTimeout(timer)
  }
}

export interface BinaryResult {
  body: Uint8Array
  contentType: string
  sourceUrl: string
}

/** Copy into a plain ArrayBuffer so the value is a valid fetch/Response body. */
export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

/** Fetch binary content (images / icons) with the same safety rails as fetchDocument. */
export async function fetchBinary(target: string, options: FetchOptions = {}): Promise<BinaryResult> {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    throw new FetchError('链接格式不正确', 400, 'invalid_url')
  }
  await assertSafeUrl(url, options.allowPrivateNetwork ?? false)

  const dispatcher = proxyDispatcher(options.proxy)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
  try {
    const response = await (dispatcher ? proxyFetch : fetch)(url, {
      redirect: 'follow',
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
      headers: {
        'user-agent': DEFAULT_UA,
        accept: options.accept ?? 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/x-icon,*/*;q=0.5',
        referer: url.origin,
        ...options.headers,
      },
    } as RequestInit)
    if (!response.ok) throw new FetchError(`图片返回 HTTP ${response.status}`, 502, 'upstream_error')
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
    const body = await readLimited(response, options.maxBytes ?? 8 * 1024 * 1024)
    return { body, contentType, sourceUrl: response.url || url.toString() }
  } catch (error) {
    if (error instanceof FetchError) throw error
    if ((error as Error).name === 'AbortError') throw new FetchError('请求超时', 504, 'timeout')
    throw new FetchError(`无法获取资源：${(error as Error).message}`, 502, 'fetch_failed')
  } finally {
    clearTimeout(timer)
  }
}
