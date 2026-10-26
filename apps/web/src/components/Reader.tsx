import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Languages,
  LayoutList,
  MoreHorizontal,
  PanelLeftOpen,
  Sparkles,
  Star,
} from 'lucide-react'
import type { Article, Feed } from '../types'
import { useAppStore, aiNeedsKey } from '../lib/store'
import { useT } from '../lib/useT'
import { cn, copyText, formatFullDate, hostnameOf, plainText, prepareArticleHtml, readingMinutes } from '../lib/utils'
import { FeedIcon } from './FeedIcon'
import { Spinner } from './ui'
import { ArticleContent } from './ArticleContent'
import { AiSummaryPanel, TranslationBar } from './AiSummaryPanel'

interface ReaderProps {
  article: Article
  feed?: Feed
  onBack: () => void
  onShowSidebar?: () => void
  onShowList?: () => void
}

export function Reader({ article, feed, onBack, onShowSidebar, onShowList }: ReaderProps) {
  const t = useT()
  const [searchParams] = useSearchParams()
  const translateFlag = searchParams.get('translate') === '1'
  const locale = useAppStore((state) => state.settings.locale)
  const settings = useAppStore((state) => state.settings)
  const translate = useAppStore((state) => state.translate)
  const markRead = useAppStore((state) => state.markRead)
  const toggleStar = useAppStore((state) => state.toggleStar)
  const ensureFullText = useAppStore((state) => state.ensureFullText)
  const translateArticle = useAppStore((state) => state.translateArticle)
  const clearTranslation = useAppStore((state) => state.clearTranslation)
  const toast = useAppStore((state) => state.toast)

  const [aiOpen, setAiOpen] = useState(Boolean(article.aiSummary))
  const [translateOpen, setTranslateOpen] = useState(translateFlag)
  const [menuOpen, setMenuOpen] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState(false)
  const [progress, setProgress] = useState(0)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [showSource, setShowSource] = useState<'html' | 'extract'>('html')
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const attempted = useRef<Set<string>>(new Set())
  const loadRef = useRef<() => Promise<void>>(async () => {})

  const language = translate.targetLanguage
  const translation = article.translations?.[language]
  const html = showSource === 'extract' && article.extractedHtml ? article.extractedHtml : article.contentHtml
  const text = useMemo(() => plainText(html), [html])
  const minutes = useMemo(() => readingMinutes(text), [text])
  const translatable = useMemo(() => prepareArticleHtml(html).blocks.length > 0, [html])
  const heroImage =
    article.imageUrl && !html.includes(article.imageUrl) && article.imageUrl !== feed?.iconUrl
      ? article.imageUrl
      : undefined

  useEffect(() => {
    setAiOpen(Boolean(article.aiSummary))
    setTranslateOpen(translateFlag)
    setMenuOpen(false)
    setExtractError(false)
    setShowSource(article.extractedHtml ? 'extract' : 'html')
    scrollRef.current?.scrollTo({ top: 0 })
    setShowBackToTop(false)
  }, [article.id, article.extractedHtml, translateFlag])

  // Opening an article through the hover "translate" action starts the
  // translation immediately when a model is configured.
  useEffect(() => {
    if (!translateFlag) return
    if (article.translations?.[translate.targetLanguage]) return
    if (!settings.ai.baseUrl.trim() || !settings.ai.model.trim() || aiNeedsKey(settings.ai)) return
    void translateArticle(article.id, translate.targetLanguage, translate.mode)
    // Only run when the flag/article changes; the translation state is global.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.id, translateFlag])

  loadRef.current = async () => {
    if (extracting) return
    setExtracting(true)
    setExtractError(false)
    try {
      const result = await ensureFullText(article.id)
      if (result === article.contentHtml) setExtractError(true)
      else setShowSource('extract')
    } catch {
      setExtractError(true)
    } finally {
      setExtracting(false)
    }
  }

  useEffect(() => {
    if (article.extractedHtml || !settings.autoExtract) return
    if (attempted.current.has(article.id)) return
    const plain = plainText(article.contentHtml)
    if (plain.length >= 700 || !article.link) return
    attempted.current.add(article.id)
    void loadRef.current()
  }, [article.id, article.contentHtml, article.extractedHtml, article.link, settings.autoExtract])

  const onScroll = (): void => {
    const element = scrollRef.current
    if (!element) return
    const max = element.scrollHeight - element.clientHeight
    setProgress(max > 0 ? Math.min(1, element.scrollTop / max) : 0)
    setShowBackToTop(max > 160 && element.scrollTop > 220)
  }

  const startTranslation = (targetLanguage: string, mode: 'bilingual' | 'translated'): void => {
    setTranslateOpen(true)
    void translateArticle(article.id, targetLanguage, mode)
  }

  const hasAnyTranslation = Object.keys(translation?.blocks ?? {}).length > 0
  const translating = translate.articleId === article.id && translate.status === 'running'

  return (
    <div className="relative flex h-full min-w-0 flex-col bg-bg">
      <div className="absolute inset-x-0 top-0 z-30 h-[2px] bg-transparent">
        <div
          className="h-full bg-accent/70 transition-[width] duration-150"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <header className="app-safe-top glass-panel sticky top-0 z-20 flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-2.5 lg:px-4">
        <button
          type="button"
          onClick={onBack}
          className="icon-button h-8 w-8 lg:hidden"
          aria-label={t('reader.back')}
        >
          <ArrowLeft size={17} />
        </button>
        {onShowSidebar && (
          <button
            type="button"
            onClick={onShowSidebar}
            className="icon-button hidden h-8 w-8 lg:flex"
            aria-label={t('layout.showSidebar')}
            title={t('layout.showSidebar')}
          >
            <PanelLeftOpen size={16} />
          </button>
        )}
        {onShowList && (
          <button
            type="button"
            onClick={onShowList}
            className="icon-button hidden h-8 w-8 lg:flex"
            aria-label={t('layout.showList')}
            title={t('layout.showList')}
          >
            <LayoutList size={16} />
          </button>
        )}
        {feed && <FeedIcon feed={feed} size={16} />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-fg">{feed?.title ?? hostnameOf(article.link)}</div>
          <div className="truncate text-[10.5px] text-subtle">
            {formatFullDate(article.publishedAt ?? article.savedAt, locale)} · {t('reader.readingTime', { n: minutes })}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setAiOpen((value) => !value)}
            className={cn('icon-button h-8 gap-1 px-2 text-[11.5px] font-medium', aiOpen && 'text-accent')}
            data-active={aiOpen}
            title={t('reader.ai')}
          >
            <Sparkles size={15} />
            <span className="hidden sm:inline">AI</span>
          </button>
          <button
            type="button"
            onClick={() => setTranslateOpen((value) => !value)}
            className={cn('icon-button h-8 w-8', (translateOpen || hasAnyTranslation) && 'text-accent')}
            data-active={translateOpen || hasAnyTranslation}
            title={t('reader.translate')}
            aria-label={t('reader.translate')}
          >
            <Languages size={15} />
          </button>
          <button
            type="button"
            onClick={() => void toggleStar(article.id)}
            className="icon-button h-8 w-8"
            data-active={article.starred}
            title={article.starred ? t('reader.unstar') : t('reader.star')}
            aria-label={article.starred ? t('reader.unstar') : t('reader.star')}
          >
            <Star size={15} fill={article.starred ? 'currentColor' : 'none'} />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              className="icon-button h-8 w-8"
              aria-label={t('reader.more')}
              aria-expanded={menuOpen}
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 top-full z-40 mt-1 w-[228px] overflow-hidden rounded-xl border border-line bg-elevated py-1 shadow-xl animate-pop-in">
                  <MenuItem
                    icon={article.read ? <ArrowLeft size={13} /> : <Check size={13} />}
                    label={article.read ? t('reader.markUnread') : t('reader.markRead')}
                    onClick={() => {
                      setMenuOpen(false)
                      void markRead(article.id, !article.read)
                    }}
                  />
                  <MenuItem
                    icon={<Copy size={13} />}
                    label={t('reader.copyLink')}
                    onClick={async () => {
                      setMenuOpen(false)
                      if (await copyText(article.link)) toast(t('toast.copied'), 'success')
                    }}
                  />
                  <MenuItem
                    icon={<ExternalLink size={13} />}
                    label={t('reader.openOriginal')}
                    onClick={() => {
                      setMenuOpen(false)
                      window.open(article.link, '_blank', 'noopener')
                    }}
                  />
                  <div className="my-1 h-px bg-line" />
                  {article.extractedHtml ? (
                    <MenuItem
                      icon={<FileText size={13} />}
                      label={showSource === 'extract' ? t('reader.fullText.useExcerpt') : t('reader.fullText.loaded')}
                      onClick={() => {
                        setMenuOpen(false)
                        setShowSource((current) => (current === 'extract' ? 'html' : 'extract'))
                      }}
                    />
                  ) : (
                    <MenuItem
                      icon={extracting ? <Spinner size={12} /> : <FileText size={13} />}
                      label={extracting ? t('reader.fullText.loading') : t('reader.fullText.load')}
                      disabled={extracting}
                      onClick={() => {
                        setMenuOpen(false)
                        attempted.current.delete(article.id)
                        void loadRef.current()
                      }}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div ref={contentRef} className="mx-auto w-full max-w-[744px] px-5 pb-24 pt-7 sm:px-8 lg:px-10 lg:pt-10">
          {(extracting || extractError) && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-hover px-3 py-2 text-[11.5px] text-muted">
              {extracting ? <Spinner size={12} className="text-accent" /> : <FileText size={12} />}
              <span className="min-w-0 flex-1">
                {extracting ? t('reader.fullText.loading') : t('reader.fullText.failed')}
              </span>
              {extractError && (
                <button
                  type="button"
                  onClick={() => {
                    attempted.current.delete(article.id)
                    void loadRef.current()
                  }}
                  className="shrink-0 font-medium text-accent hover:underline"
                >
                  {t('reader.fullText.retry')}
                </button>
              )}
              {article.extractedHtml && !extracting && (
                <button
                  type="button"
                  onClick={() => setShowSource((current) => (current === 'extract' ? 'html' : 'extract'))}
                  className="shrink-0 font-medium text-accent hover:underline"
                >
                  {showSource === 'extract' ? t('reader.fullText.useExcerpt') : t('reader.fullText.loaded')}
                </button>
              )}
            </div>
          )}

          <h1 className="text-balance text-[24px] font-semibold leading-[1.28] tracking-[-0.015em] sm:text-[28px] lg:text-[32px]">
            {article.title || t('reader.untitled')}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted">
            {article.author && <span>{article.author}</span>}
            {article.categories.slice(0, 3).map((category) => (
              <span key={category} className="rounded-full bg-hover px-2 py-0.5 text-[10.5px] text-muted">
                {category}
              </span>
            ))}
            <span className="ml-auto text-[11px] text-subtle">{t('reader.readingTime', { n: minutes })}</span>
          </div>

          {heroImage && (
            <img
              src={heroImage}
              alt=""
              className="mt-5 max-h-[340px] w-full rounded-xl bg-hover object-cover"
              loading="eager"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
          )}

          <AiSummaryPanel article={article} open={aiOpen} onToggle={() => setAiOpen((value) => !value)} />

          {(translateOpen || hasAnyTranslation || translating) && (
            <TranslationBar
              article={article}
              translatable={translatable}
              onTranslate={startTranslation}
              onClear={(target) => void clearTranslation(article.id, target)}
            />
          )}

          {article.audioUrl && (
            <audio controls preload="none" src={article.audioUrl} className="mt-4 w-full">
              <track kind="captions" />
            </audio>
          )}

          <ArticleContent
            articleId={article.id}
            html={html}
            translationBlocks={translation?.blocks}
            translationMode={translate.mode}
          />

          <footer className="mt-10 border-t border-line pt-5">
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline w-full gap-2 px-4 py-2.5 text-[13px] sm:w-auto"
            >
              <ExternalLink size={14} />
              {t('reader.openOriginal')}
              <span className="max-w-[220px] truncate text-[11px] font-normal text-subtle">
                {hostnameOf(article.link)}
              </span>
            </a>
            {/*<p className="mt-3 text-[11px] leading-relaxed text-subtle">{t('keyboard.hint')}</p>*/}
          </footer>
        </div>
      </div>
      {showBackToTop && (
        <button
          type="button"
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="absolute bottom-5 right-4 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-elevated/95 text-muted shadow-lg backdrop-blur transition-colors hover:text-fg sm:bottom-6 sm:right-6"
          aria-label={t('reader.backToTop')}
          title={t('reader.backToTop')}
        >
          <ArrowUp size={16} />
        </button>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] transition-colors',
        disabled ? 'cursor-default text-subtle' : 'text-fg hover:bg-hover',
      )}
    >
      <span className="shrink-0 text-subtle">{icon}</span>
      {label}
    </button>
  )
}
