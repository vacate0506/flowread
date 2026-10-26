import { useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../lib/store'
import { applyTranslations, imageProxyUrl, prepareArticleHtml } from '../lib/utils'

interface ArticleContentProps {
  articleId: string
  html: string
  translationBlocks?: Record<string, string>
  translationMode: 'bilingual' | 'translated'
}

export function ArticleContent({ articleId, html, translationBlocks, translationMode }: ArticleContentProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiBase = useAppStore((state) => state.settings.apiBase)
  const fontSize = useAppStore((state) => state.settings.fontSize)
  const prepared = useMemo(() => prepareArticleHtml(html), [html])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    applyTranslations(container, translationBlocks, translationMode)
  }, [prepared.html, translationBlocks, translationMode])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onError = (event: Event): void => {
      const target = event.target
      if (!(target instanceof HTMLImageElement)) return
      if (target.dataset.flowreadProxy) return
      target.dataset.flowreadProxy = '1'
      const source = target.currentSrc || target.src
      if (!source || source.startsWith('data:')) return
      target.src = imageProxyUrl(source, apiBase)
    }
    container.addEventListener('error', onError, true)
    return () => container.removeEventListener('error', onError, true)
  }, [prepared.html, apiBase])

  return (
    <div
      key={articleId}
      ref={containerRef}
      className="flowread-prose mt-6"
      style={{ ['--reader-font-size' as string]: `${fontSize}px` }}
      dangerouslySetInnerHTML={{ __html: prepared.html }}
    />
  )
}
