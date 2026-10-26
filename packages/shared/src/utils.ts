const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  times: '×',
  divide: '÷',
  eacute: 'é',
  egrave: 'è',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  szlig: 'ß',
  agrave: 'à',
  ccedil: 'ç',
  shy: '\u00ad',
  thinsp: ' ',
  ensp: ' ',
  emsp: ' ',
  zwj: '',
  zwnj: '',
}

/** Decode the handful of HTML entities that actually appear in feeds. */
export function decodeEntities(input: string): string {
  if (!input || input.indexOf('&') === -1) return input
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X'
      const code = Number.parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10)
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code)
        } catch {
          return match
        }
      }
      return match
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

/** Remove tags / scripts and collapse whitespace. */
export function stripHtml(html: string | undefined | null): string {
  if (!html) return ''
  const withoutBlocks = html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr|section|article|figure)>/gi, '\n')
    .replace(/<(p|div|li|h[1-6]|blockquote|tr|section|article|figure)\b[^>]*>/gi, '\n')
  const text = withoutBlocks.replace(/<[^>]+>/g, '')
  return decodeEntities(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** First meaningful image inside an HTML fragment. */
export function firstImageFromHtml(html: string | undefined | null, baseUrl?: string): string | undefined {
  if (!html) return undefined
  const matches = [...html.matchAll(/<img\b[^>]*>/gi)]
  for (const match of matches) {
    const tag = match[0]
    const src =
      /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ??
      /\sdata-src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ??
      /\ssrcset\s*=\s*["']([^"'\s,]+)/i.exec(tag)?.[1]
    if (src && !/^data:/i.test(src) && !/\.svg($|\?)/i.test(src)) {
      return absolutizeUrl(decodeEntities(src), baseUrl)
    }
  }
  return undefined
}

/** Resolve a possibly-relative URL against a base. */
export function absolutizeUrl(url: string, base?: string): string {
  if (!url) return url
  if (/^(https?:|mailto:|data:|blob:)/i.test(url)) return url
  if (!base) return url
  try {
    return new URL(url, base).toString()
  } catch {
    return url
  }
}

/** Tiny deterministic string hash (FNV-1a, 32 bit) rendered as base36. */
export function hashString(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function estimateReadingTime(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  const words = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').split(/\s+/).filter(Boolean).length
  const minutes = cjk / 400 + words / 220
  return Math.max(1, Math.round(minutes))
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max).trimEnd()}…`
}

/** Parse a feed date with sane fallbacks for sloppy Chinese/English feeds. */
export function parseDate(value: unknown): number | undefined {
  if (value == null) return undefined
  const raw = String(value).trim()
  if (!raw) return undefined
  const direct = Date.parse(raw)
  if (Number.isFinite(direct)) return direct
  // "2024-05-01 12:30:00" is parsed as local time only by some engines.
  const normalized = raw.replace(' ', 'T')
  const second = Date.parse(normalized)
  if (Number.isFinite(second)) return second
  const withoutZone = Date.parse(`${normalized}Z`)
  if (Number.isFinite(withoutZone)) return withoutZone
  return undefined
}

/** Pick the largest candidate from a `srcset` attribute. */
export function pickFromSrcset(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined
  const parts = srcset
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return undefined
  let best = parts[0]!
  let bestScore = 0
  for (const part of parts) {
    const [url, descriptor] = part.split(/\s+/, 2)
    const score = Number.parseFloat(descriptor ?? '1') || 1
    if (url && score >= bestScore) {
      best = url
      bestScore = score
    }
  }
  return best.split(/\s+/)[0]
}

export function isHttpUrl(value: string | undefined | null): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Normalise a user-typed feed URL (adds https:// when the scheme is missing). */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}
