import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ExternalLink, Loader2, Sparkles, Volume2, VolumeX, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Article, Feed } from '../types'
import { useAppStore, aiNeedsKey } from '../lib/store'
import { useT } from '../lib/useT'
import { cn } from '../lib/utils'
import { toggleSpeech, useSpeechState } from '../lib/speech'
import { FloatingPanel } from './FloatingPanel'
import { FeedIcon } from './FeedIcon'

interface ArticleSummaryCardProps {
  article: Article
  feed?: Feed
  anchor: { left: number; top: number; right: number; bottom: number }
  onClose: () => void
}

/** Folo-style hover card: AI summary + listen + open the full article. */
export function ArticleSummaryCard({ article, feed, anchor, onClose }: ArticleSummaryCardProps) {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const ai = useAppStore((state) => state.ai)
  const summarize = useAppStore((state) => state.summarize)
  const settings = useAppStore((state) => state.settings)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const speech = useSpeechState()
  const requested = useRef(false)

  const active = ai.articleId === article.id
  const running = active && ai.status === 'running'
  const error = active && ai.status === 'error' ? ai.error : undefined
  const text = (active ? ai.text : '') || article.aiSummary?.text || ''
  const needsKey = aiNeedsKey(settings.ai)
  const speaking = speech.articleId === article.id && speech.status === 'playing'

  useEffect(() => {
    if (requested.current) return
    if (text || running || error || needsKey) return
    requested.current = true
    void summarize(article.id, article.aiSummary?.mode ?? 'key-points')
  }, [article.id, article.aiSummary?.mode, error, needsKey, running, summarize, text])

  const openArticle = (): void => {
    const params = new URLSearchParams(location.search)
    params.set('a', article.id)
    onClose()
    navigate({ pathname: location.pathname, search: params.toString() })
  }

  return (
    <FloatingPanel
      open
      x={anchor.left - 36}
      y={anchor.bottom + 8}
      width={396}
      onClose={onClose}
    >
      <header className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        {feed && <FeedIcon feed={feed} size={18} />}
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-muted">{feed?.title ?? ''}</span>
        <button type="button" onClick={onClose} className="icon-button h-6 w-6" aria-label={t('common.close')}>
          <X size={13} />
        </button>
      </header>

      <div className="max-h-[62vh] overflow-y-auto px-4 pb-3 pt-3">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight">{article.title}</h3>

        <div className="mt-3 flex items-center gap-1.5 text-[10.5px] font-medium text-accent">
          <Sparkles size={11} />
          {running ? t('summary.generating') : t('reader.ai')}
        </div>

        {running && !text && (
          <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
            <Loader2 size={12} className="animate-spin text-accent" />
            {t('summary.generating')}
          </div>
        )}

        {text && (
          <div className={cn('ai-markdown mt-1.5', running && 'stream-caret')}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        )}

        {!text && !running && !error && !needsKey && (
          <p className="mt-2 text-[12px] text-muted">{t('summary.empty')}</p>
        )}

        {needsKey && !text && (
          <div className="mt-2 rounded-lg bg-hover px-3 py-2 text-[11.5px] text-muted">
            <p>{t('ai.needConfig')}</p>
            <button
              type="button"
              onClick={() => {
                onClose()
                setSettingsOpen(true)
              }}
              className="mt-1.5 text-[11px] font-medium text-accent hover:underline"
            >
              {t('summary.configure')}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-2 rounded-lg bg-danger/8 px-2.5 py-2 text-[11.5px] text-danger">
            <p className="break-words">{error}</p>
            <button
              type="button"
              onClick={() => void summarize(article.id, article.aiSummary?.mode ?? 'key-points')}
              className="mt-1.5 text-[11px] font-medium underline-offset-2 hover:underline"
            >
              {t('summary.retry')}
            </button>
          </div>
        )}

        {text && <p className="mt-2 text-[10px] text-subtle">{t('summary.note')}</p>}
      </div>

      <footer className="flex items-center gap-1.5 border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={() => toggleSpeech(article)}
          className={cn('btn btn-ghost gap-1.5 px-2.5 py-1.5 text-[11.5px]', speaking && 'text-accent')}
        >
          {speaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
          {speaking ? t('actions.stopListening') : t('actions.listen')}
        </button>
        <button
          type="button"
          onClick={openArticle}
          className="btn btn-primary ml-auto gap-1.5 px-3 py-1.5 text-[11.5px]"
        >
          {t('summary.openArticle')}
          <ExternalLink size={12} />
        </button>
      </footer>
    </FloatingPanel>
  )
}
