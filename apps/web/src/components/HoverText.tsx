import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isTauriAndroid } from '../lib/platform'

/**
 * Text that shows a floating tooltip with its full value when it is actually
 * truncated by CSS. Used for long subscription / folder names in the sidebar.
 */
export function HoverText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 0 })
  const enabled = !isTauriAndroid()

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const show = (): void => {
    if (!enabled) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const element = ref.current
      if (!element) return
      if (element.scrollWidth <= element.clientWidth + 1) return
      const rect = element.getBoundingClientRect()
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
        top: rect.bottom + 6,
      })
      setOpen(true)
    }, 350)
  }

  const hide = (): void => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }

  return (
    <>
      <span
        ref={ref}
        className={className}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {text}
      </span>
      {enabled &&
        open &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[100] max-w-[320px] rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-[11px] font-normal leading-snug text-fg shadow-xl"
            style={{ left: position.left, top: position.top }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  )
}
