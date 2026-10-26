import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { cn } from '../lib/utils'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  onSelect: () => void
}

export interface ContextMenuSection {
  label?: string
  items: ContextMenuItem[]
}

interface ContextMenuProps {
  open: boolean
  x: number
  y: number
  sections: ContextMenuSection[]
  onClose: () => void
}

/** A small, viewport-aware right-click menu rendered in a portal. */
export function ContextMenu({ open, x, y, sections, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })

  useLayoutEffect(() => {
    if (!open) return
    const element = ref.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const margin = 8
    setPosition({
      x: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)),
    })
  }, [open, x, y])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    const onViewportChange = (): void => onClose()

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onViewportChange)
    document.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onViewportChange)
      document.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[90] max-h-[calc(100dvh-16px)] w-[238px] overflow-y-auto rounded-xl border border-line bg-elevated p-1 shadow-2xl animate-pop-in"
      style={{ left: position.x, top: position.y }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {sections.map((section, sectionIndex) => (
        <div key={section.label ?? sectionIndex} className={cn(sectionIndex > 0 && 'mt-1 border-t border-line pt-1')}>
          {section.label && (
            <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-subtle">
              {section.label}
            </div>
          )}
          {section.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                onClose()
                item.onSelect()
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[12.5px] transition-colors',
                item.danger ? 'text-danger hover:bg-danger/10' : 'text-fg hover:bg-hover',
                item.disabled && 'cursor-default text-subtle hover:bg-transparent',
              )}
            >
              <span className={cn('flex w-4 shrink-0 justify-center', item.danger ? 'text-danger' : 'text-subtle')}>
                {item.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.checked && <Check size={12} className="shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  )
}
