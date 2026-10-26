import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Copy, Languages, RotateCcw, Sparkles, Square, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { SummaryMode } from '@flowread/shared'
import type { Article } from '../types'
import { useAppStore } from '../lib/store'
import { useT } from '../lib/useT'
import { cn, copyText } from '../lib/utils'
import { languageLabel } from '../lib/languages'
import { Segmented, Spinner } from './ui'

const MODES: SummaryMode[] = ['tldr', 'key-points', 'detailed']

interface AiSummaryPanelProps {
  article: Article
  open: boolean
  onToggle: () => void
}

export function AiSummaryPanel({ article, open, onToggle }: AiSummaryPanelProps) {
  const t = useT()
  const ai = useAppStore((state) => state.ai)
  const summarize = useAppStore((state) => state.summarize)
  const stopSummary = useAppStore((state) => state.stopSummary)
  const toast = useAppStore((state) => state.toast)
  const [mode, setMode] = useState<SummaryMode>(article.aiSummary?.mode ?? 'key-points')

  const active = ai.articleId === article.id
  const running = active && ai.status === 'running'
  const error = active && ai.status === 'error' ? ai.error : undefined
  const cached = article.aiSummary
  const text = active ? ai.text : cached && cached.mode === mode ? cached.text : ''
  const hasText = Boolean(text.trim())
  const model = active ? ai.model : cached?.model

  useEffect(() => {
    setMode(article.aiSummary?.mode ?? 'key-points')
  }, [article.id, article.aiSummary?.mode])

  const modeLabels: Record<SummaryMode, string> = useMemo(
    () => ({
      tldr: t('ai.mode.tldr'),
      'key-points': t('ai.mode.keyPoints'),
      detailed: t('ai.mode.detailed'),
    }),
    [t],
  )

  const run = (nextMode: SummaryMode): void => {
    setMode(nextMode)
    void summarize(article.id, nextMode)
  }

  const onSelectMode = (nextMode: SummaryMode): void => {
    setMode(nextMode)
    if (running) return
    if (article.aiSummary?.mode !== nextMode) void summarize(article.id, nextMode)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="group mt-4 flex w-full items-center gap-2.5 rounded-xl border border-dashed border-line-strong px-3.5 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft/40"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Sparkles size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold text-fg">
            {cached ? t('ai.cached') : t('ai.title')}
          </span>
          <span className="line-clamp-1 text-[11.5px] text-muted">
            {cached ? cached.text.replace(/[#*>]/g, '').slice(0, 90) : t('ai.empty')}
          </span>
        </span>
        <ChevronDown size={14} className="shrink-0 text-subtle transition-transform group-hover:text-fg" />
      </button>
    )
  }

  return (
    <section className="relative mt-4 overflow-hidden rounded-xl border border-accent/25 bg-surface">
      <div className="absolute inset-0 accent-gradient opacity-70" aria-hidden="true" />
      <div className="relative">
        <header className="flex flex-wrap items-center gap-2 px-3.5 pb-2 pt-3">
          <Sparkles size={14} className="shrink-0 text-accent" />
          <span className="text-[12.5px] font-semibold tracking-tight">{t('ai.title')}</span>
          <Segmented
            size="sm"
            className="ml-1"
            value={mode}
            onChange={onSelectMode}
            options={MODES.map((candidate) => ({ value: candidate, label: modeLabels[candidate] }))}
          />
          <div className="ml-auto flex items-center gap-0.5">
            {hasText && !running && (
              <button
                type="button"
                onClick={async () => {
                  if (await copyText(text)) toast(t('ai.copied'), 'success')
                }}
                className="icon-button h-6 w-6"
                title={t('ai.copy')}
                aria-label={t('ai.copy')}
              >
                <Copy size={12} />
              </button>
            )}
            {running ? (
              <button
                type="button"
                onClick={stopSummary}
                className="icon-button h-6 w-6 text-accent"
                title={t('ai.stopped')}
                aria-label={t('ai.stopped')}
              >
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => run(mode)}
                className="icon-button h-6 w-6"
                title={t('ai.regenerate')}
                aria-label={t('ai.regenerate')}
              >
                <RotateCcw size={12} />
              </button>
            )}
            <button
              type="button"
              onClick={onToggle}
              className="icon-button h-6 w-6"
              aria-label={t('common.close')}
            >
              <ChevronDown size={13} className="rotate-180" />
            </button>
          </div>
        </header>

        <div className="px-4 pb-3">
          {running && !hasText && (
            <div className="flex items-center gap-2 text-[12.5px] text-muted">
              <Spinner size={12} className="text-accent" />
              {t('ai.thinking')}
            </div>
          )}

          {hasText && (
            <div className={cn('ai-markdown', running && 'stream-caret')}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            </div>
          )}

          {!running && !hasText && !error && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[12.5px] text-muted">{t('ai.empty')}</p>
              <button type="button" onClick={() => run(mode)} className="btn btn-primary px-2.5 py-1 text-[11.5px]">
                <Sparkles size={11} />
                {t('ai.generate')}
              </button>
            </div>
          )}

          {error && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-danger/8 px-2.5 py-2 text-[12px] text-danger">
              <span className="min-w-0 flex-1">{error}</span>
              <button type="button" onClick={() => run(mode)} className="btn btn-outline px-2 py-0.5 text-[11px]">
                {t('common.retry')}
              </button>
            </div>
          )}

          {(hasText || cached) && !running && (
            <div className="mt-2 text-[10.5px] text-subtle">
              {model ? t('ai.disclaimer', { model }) : ''}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

interface TranslationBarProps {
  article: Article
  translatable: boolean
  onTranslate: (language: string, mode: 'bilingual' | 'translated') => void
  onClear: (language: string) => void
}

export function TranslationBar({ article, translatable, onTranslate, onClear }: TranslationBarProps) {
  const t = useT()
  const translate = useAppStore((state) => state.translate)
  const setTranslateMode = useAppStore((state) => state.setTranslateMode)
  const defaultLanguage = useAppStore((state) => state.settings.targetLanguage)
  const active = translate.articleId === article.id
  const [language, setLanguage] = useState(active ? translate.targetLanguage : defaultLanguage)

  const available = article.translations?.[language]
  const running = active && translate.status === 'running' && translate.targetLanguage === language
  const done = active ? translate.doneBlocks : Object.keys(available?.blocks ?? {}).length
  const total = active ? translate.totalBlocks : Object.keys(available?.blocks ?? {}).length
  const hasTranslation = Boolean(available && Object.keys(available.blocks).length > 0) || running

  useEffect(() => {
    if (active) setLanguage(translate.targetLanguage)
  }, [active, translate.targetLanguage])

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
      <Languages size={13} className="text-accent" />
      <span className="text-[12px] font-semibold">{t('translate.title')}</span>
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value)}
        className="rounded-md border border-line bg-bg px-1.5 py-1 text-[11px] text-muted"
        aria-label={t('translate.target')}
      >
        {['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es'].map((code) => (
          <option key={code} value={code}>
            {languageLabel(code)}
          </option>
        ))}
      </select>

      {hasTranslation && (
        <Segmented
          size="sm"
          value={translate.mode}
          onChange={(mode) => setTranslateMode(mode)}
          options={[
            { value: 'bilingual', label: t('translate.bilingual') },
            { value: 'translated', label: t('translate.only') },
          ]}
        />
      )}

      {running && (
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <Spinner size={11} className="text-accent" />
          {t('translate.progress', { done, total })}
        </span>
      )}
      {active && translate.status === 'error' && (
        <span className="min-w-0 flex-1 truncate text-[11px] text-danger">{translate.error}</span>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        {!translatable && <span className="text-[11px] text-subtle">{t('translate.noBlocks')}</span>}
        {translatable && !running && (
          <button
            type="button"
            onClick={() => onTranslate(language, translate.mode)}
            className="btn btn-primary px-2.5 py-1 text-[11px]"
          >
            {hasTranslation ? t('translate.retry') : t('translate.start')}
          </button>
        )}
        {hasTranslation && !running && (
          <button
            type="button"
            onClick={() => onClear(language)}
            className="btn btn-ghost px-2 py-1 text-[11px] text-subtle hover:text-danger"
          >
            <Trash2 size={11} />
            {t('translate.clear')}
          </button>
        )}
      </div>
    </div>
  )
}
