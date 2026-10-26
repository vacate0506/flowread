import { useState } from 'react'
import { Cpu, Database, FolderInput, Globe2, Plus, Sparkles } from 'lucide-react'
import { useAppStore } from '../lib/store'
import { useT } from '../lib/useT'
import { BrandMark } from './FeedIcon'
import { OpmlImportButton } from './OpmlImportButton'
import { Spinner } from './ui'

export function Welcome() {
  const t = useT()
  const setAddFeedOpen = useAppStore((state) => state.setAddFeedOpen)
  const loadSampleFeeds = useAppStore((state) => state.loadSampleFeeds)
  const toast = useAppStore((state) => state.toast)
  const [loadingSample, setLoadingSample] = useState(false)

  const loadSample = async (): Promise<void> => {
    setLoadingSample(true)
    try {
      const result = await loadSampleFeeds()
      const skipped = result.skipped.length
      toast(
        t(skipped > 0 ? 'onboarding.importedSkipped' : 'onboarding.imported', {
          feeds: result.feeds,
          articles: result.articles,
          skipped,
        }),
        skipped > 0 ? 'info' : 'success',
      )
    } catch (error) {
      toast((error as Error).message || t('toast.error'), 'error')
    } finally {
      setLoadingSample(false)
    }
  }

  const features = [
    { icon: <Sparkles size={14} />, title: t('welcome.features.ai'), desc: t('welcome.features.aiDesc') },
    { icon: <Database size={14} />, title: t('welcome.features.offline'), desc: t('welcome.features.offlineDesc') },
    { icon: <Globe2 size={14} />, title: t('welcome.features.cross'), desc: t('welcome.features.crossDesc') },
  ]

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center">
      <div className="relative mb-5">
        <div className="absolute -inset-6 rounded-full bg-accent/10 blur-2xl" aria-hidden="true" />
        <BrandMark size={52} />
      </div>
      <h2 className="text-balance text-[21px] font-semibold tracking-tight">{t('welcome.title')}</h2>
      <p className="mt-2 max-w-[340px] text-[12.5px] leading-relaxed text-muted">{t('welcome.desc')}</p>

      <div className="mt-6 flex w-full max-w-[320px] flex-col gap-2">
        <OpmlImportButton variant="primary" className="w-full justify-center py-2 text-[12.5px]" />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadSample()}
            disabled={loadingSample}
            className="btn btn-outline flex-1 justify-center py-2 text-[12px]"
          >
            {loadingSample ? <Spinner size={12} /> : <Cpu size={12} />}
            {t('welcome.sample')}
          </button>
          <button
            type="button"
            onClick={() => setAddFeedOpen(true)}
            className="btn btn-outline flex-1 justify-center py-2 text-[12px]"
          >
            <Plus size={12} />
            {t('welcome.add')}
          </button>
        </div>
      </div>

      <div className="mt-9 w-full max-w-[340px] space-y-3 text-left">
        {features.map((feature) => (
          <div key={feature.title} className="flex items-start gap-2.5 rounded-lg px-1 py-0.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
              {feature.icon}
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-fg">{feature.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-subtle">{feature.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 flex items-center gap-1.5 text-[10.5px] text-subtle">
        <FolderInput size={11} />
        OPML · RSS 2.0 · Atom · JSON Feed
      </p>
    </div>
  )
}
