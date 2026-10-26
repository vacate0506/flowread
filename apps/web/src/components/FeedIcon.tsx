import { useMemo, useState } from 'react'
import type { Feed } from '../types'
import { cn, hostnameOf, hueFromString, iconUrlFor } from '../lib/utils'
import { useAppStore } from '../lib/store'

interface FeedIconProps {
  feed: Pick<Feed, 'id' | 'title' | 'iconUrl' | 'siteUrl'>
  size?: number
  className?: string
}

export function FeedIcon({ feed, size = 18, className }: FeedIconProps) {
  const apiBase = useAppStore((state) => state.settings.apiBase)
  const [failed, setFailed] = useState(false)
  const src = useMemo(() => iconUrlFor(feed.siteUrl, feed.iconUrl, apiBase), [feed.siteUrl, feed.iconUrl, apiBase])
  const hue = hueFromString(feed.title || feed.id)
  const letter = (feed.title || hostnameOf(feed.siteUrl) || hostnameOf(feed.id) || '?').trim().charAt(0).toUpperCase()

  const style = {
    width: size,
    height: size,
    borderRadius: Math.max(4, Math.round(size * 0.24)),
  }

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={cn('shrink-0 bg-hover object-cover', className)}
        style={style}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center font-semibold', className)}
      style={{
        ...style,
        fontSize: Math.max(8, Math.round(size * 0.52)),
        background: `hsl(${hue} 70% 92% / 0.9)`,
        color: `hsl(${hue} 62% 34%)`,
      }}
    >
      {letter}
    </span>
  )
}

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="flowread-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff7a1a" />
          <stop offset="1" stopColor="#ff4d00" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#flowread-brand)" />
      <g fill="none" stroke="#fff" strokeLinecap="round" strokeWidth="5">
        <path d="M17 46a4 4 0 0 1 0-8" />
        <path d="M17 35a15 15 0 0 1 15 15" />
        <path d="M17 24a26 26 0 0 1 26 26" />
      </g>
      <circle cx="18" cy="46" r="4" fill="#fff" />
    </svg>
  )
}
