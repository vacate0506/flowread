import { useMemo } from 'react'
import { useAppStore } from './store'
import { createTranslator } from './i18n'

export type Translate = (key: string, vars?: Record<string, string | number>) => string

/** Locale-aware translator bound to the current settings. */
export function useT(): Translate {
  const locale = useAppStore((state) => state.settings.locale)
  return useMemo(() => createTranslator(locale), [locale])
}
