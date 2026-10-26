import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Download,
  FileDown,
  FileUp,
  Globe2,
  HardDrive,
  Info,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  RefreshCw,
  Server,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'
import { AI_PRESETS } from '@flowread/shared'
import type { AiProvider } from '@flowread/shared'
import { useAppStore, aiNeedsKey } from '../lib/store'
import { useT } from '../lib/useT'
import { apiUrl, cn, downloadBlob, formatBytes } from '../lib/utils'
import { isTauri } from '../lib/platform'
import { testAi, fetchAiModels } from '../lib/api'
import { normalizeProxyUrl, proxyForAi } from '../lib/proxy'
import { languageLabel } from '../lib/languages'
import { FeedIcon } from './FeedIcon'
import { OpmlImportButton } from './OpmlImportButton'
import { ConfirmDialog } from './ConfirmDialog'
import { Modal, Segmented, Spinner, Switch } from './ui'
import type { Locale, ProxySettings, ThemeMode } from '../types'

const VERSION = '0.1.0'
const LANGUAGES = ['auto', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es']
const TRANSLATE_LANGUAGES = LANGUAGES.filter((code) => code !== 'auto')
const REFRESH_OPTIONS = [0, 15, 30, 60, 180]

export function SettingsModal() {
  const t = useT()
  const open = useAppStore((state) => state.settingsOpen)
  const setOpen = useAppStore((state) => state.setSettingsOpen)
  const settings = useAppStore((state) => state.settings)
  const saveSettings = useAppStore((state) => state.saveSettings)
  const feeds = useAppStore((state) => state.feeds)
  const articles = useAppStore((state) => state.articles)
  const folders = useAppStore((state) => state.folders)
  const exportOpml = useAppStore((state) => state.exportOpml)
  const exportBackup = useAppStore((state) => state.exportBackup)
  const importBackup = useAppStore((state) => state.importBackup)
  const refreshAll = useAppStore((state) => state.refreshAll)
  const clearData = useAppStore((state) => state.clearData)
  const refreshing = useAppStore((state) => state.refreshing)
  const toast = useAppStore((state) => state.toast)

  const [testState, setTestState] = useState<{ status: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }>({
    status: 'idle',
  })
  const [serverState, setServerState] = useState<{ status: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }>({
    status: 'idle',
  })
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [includeKey, setIncludeKey] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [clearConfirm, setClearConfirm] = useState(false)
  const backupInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTestState({ status: 'idle' })
      setServerState({ status: 'idle' })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    if (navigator.storage?.estimate) {
      navigator.storage
        .estimate()
        .then((estimate) => {
          if (!cancelled) setStorage({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 })
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [open, articles.length, feeds.length])

  const exportConfig = (): void => {
    const json = exportBackup(includeKey)
    downloadBlob(
      json,
      `flowread-config-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    )
    toast(t('backup.exported'), 'success')
  }

  const importConfig = async (file: File): Promise<void> => {
    setBackupBusy(true)
    try {
      const text = await file.text()
      const result = await importBackup(text)
      toast(t('backup.imported', { feeds: result.feeds, folders: result.folders }), 'success')
    } catch (error) {
      toast(`${t('backup.invalid')}：${(error as Error).message}`, 'error')
    } finally {
      setBackupBusy(false)
    }
  }

  const ai = settings.ai
  const updateProxy = (patch: Partial<ProxySettings>): void => {
    void saveSettings({ proxy: { ...settings.proxy, ...patch } })
  }
  const proxyInvalid =
    settings.proxy.enabled && settings.proxy.url.trim().length > 0 && !normalizeProxyUrl(settings.proxy.url)

  const updateAi = (patch: Partial<typeof ai>): void => {
    if ('provider' in patch || 'baseUrl' in patch || 'apiKey' in patch) {
      setModels([])
      setModelsError(null)
    }
    void saveSettings({ ai: { ...ai, ...patch } })
    setTestState({ status: 'idle' })
  }

  const canFetchModels = ai.baseUrl.trim().length > 0 && !aiNeedsKey(ai)

  const loadModels = async (): Promise<void> => {
    if (!canFetchModels) return
    setModelsLoading(true)
    setModelsError(null)
    try {
      const list = await fetchAiModels(ai, settings.apiBase, proxyForAi(settings))
      setModels(list)
      if (list.length === 0) {
        setModelsError(t('settings.ai.models.empty'))
      } else if (!list.includes(ai.model)) {
        updateAi({ model: list[0]! })
      }
    } catch (error) {
      setModelsError((error as Error).message)
    } finally {
      setModelsLoading(false)
    }
  }

  const onProviderChange = (provider: AiProvider): void => {
    const preset = AI_PRESETS.find((candidate) => candidate.id === provider)
    updateAi({
      provider,
      ...(preset && preset.baseUrl ? { baseUrl: preset.baseUrl } : {}),
      ...(preset && preset.model ? { model: preset.model } : {}),
    })
  }

  const runAiTest = async (): Promise<void> => {
    setTestState({ status: 'testing' })
    try {
      const result = await testAi(ai, settings.apiBase, proxyForAi(settings))
      if (result.ok) setTestState({ status: 'ok', message: result.reply })
      else setTestState({ status: 'fail', message: result.error })
    } catch (error) {
      setTestState({ status: 'fail', message: (error as Error).message })
    }
  }

  const runServerCheck = async (): Promise<void> => {
    setServerState({ status: 'testing' })
    try {
      const response = await fetch(apiUrl('/api/health', settings.apiBase))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as { ok?: boolean; version?: string }
      setServerState({ status: 'ok', message: data.version })
    } catch (error) {
      setServerState({ status: 'fail', message: (error as Error).message })
    }
  }

  return (
    <>
      <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={t('settings.title')}
      subtitle={t('settings.subtitle')}
      width="lg"
      className="sm:h-[84dvh]"
      footer={
        <>
          <span className="mr-auto text-[10.5px] text-subtle">v{VERSION}</span>
          <button type="button" onClick={() => setOpen(false)} className="btn btn-primary px-3.5 py-1.5 text-xs">
            {t('common.done')}
          </button>
        </>
      }
    >
      <div className="space-y-7">
        <Section title={t('settings.section.appearance')}>
          <Row label={t('settings.theme')}>
            <Segmented<ThemeMode>
              value={settings.theme}
              onChange={(theme) => void saveSettings({ theme })}
              options={[
                { value: 'light', label: t('settings.theme.light'), icon: <Sun size={12} /> },
                { value: 'dark', label: t('settings.theme.dark'), icon: <Moon size={12} /> },
                { value: 'system', label: t('settings.theme.system'), icon: <Monitor size={12} /> },
              ]}
            />
          </Row>
          <Row label={t('settings.locale')}>
            <Segmented<Locale>
              value={settings.locale}
              onChange={(locale) => void saveSettings({ locale })}
              options={[
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Row>
          <div className="py-3">
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-medium">{t('settings.fontSize')}</span>
              <span className="text-[11.5px] tabular-nums text-subtle">{settings.fontSize}px</span>
            </div>
            <input
              type="range"
              min={15}
              max={22}
              step={1}
              value={settings.fontSize}
              onChange={(event) => void saveSettings({ fontSize: Number(event.target.value) })}
              className="mt-2 w-full accent-[var(--accent)]"
            />
            <p
              className="mt-1.5 rounded-lg bg-hover px-3 py-2 text-muted"
              style={{ fontSize: settings.fontSize, lineHeight: 1.7 }}
            >
              {t('settings.preview')}
            </p>
          </div>
        </Section>

        <Section title={t('settings.section.reading')}>
          <Switch
            checked={settings.markReadOnOpen}
            onChange={(value) => void saveSettings({ markReadOnOpen: value })}
            label={t('settings.markReadOnOpen')}
            description={t('settings.markReadOnOpen.desc')}
          />
          <Switch
            checked={settings.autoExtract}
            onChange={(value) => void saveSettings({ autoExtract: value })}
            label={t('settings.autoExtract')}
            description={t('settings.autoExtract.desc')}
          />
          <Row label={t('settings.refreshInterval')} description={t('settings.refreshInterval.desc')}>
            <select
              value={settings.refreshMinutes}
              onChange={(event) => void saveSettings({ refreshMinutes: Number(event.target.value) })}
              className="field w-auto py-1.5 text-xs"
            >
              {REFRESH_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === 0 ? t('settings.refresh.never') : t('settings.refresh.minutes', { n: minutes })}
                </option>
              ))}
            </select>
          </Row>
        </Section>

        <Section title={t('settings.section.ai')} icon={<KeyRound size={13} />}>
          <Row label={t('settings.ai.provider')}>
            <select
              aria-label={t('settings.ai.provider')}
              value={ai.provider}
              onChange={(event) => onProviderChange(event.target.value as AiProvider)}
              className="field w-auto py-1.5 text-xs"
            >
              {AI_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('settings.ai.baseUrl')}>
            <input
              value={ai.baseUrl}
              onChange={(event) => updateAi({ baseUrl: event.target.value })}
              className="field w-full max-w-[300px] py-1.5 text-xs"
              placeholder="https://api.deepseek.com/v1"
              spellCheck={false}
            />
          </Row>
          <Row label={t('settings.ai.apiKey')}>
            <div className="w-full max-w-[300px]">
              <div className="flex items-center gap-1.5">
                <input
                  value={ai.apiKey}
                  onChange={(event) => updateAi({ apiKey: event.target.value })}
                  type={showKey ? 'text' : 'password'}
                  className="field w-full py-1.5 font-mono text-xs"
                  placeholder={t('settings.ai.apiKey.placeholder')}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((value) => !value)}
                  className="shrink-0 text-[10.5px] text-subtle hover:text-fg"
                >
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>
              {ai.apiKey && (
                <p className="mt-1 flex items-center gap-1 text-[10px] text-success">
                  <ShieldCheck size={10} /> {t('ai.keySaved')}
                  <button
                    type="button"
                    onClick={() => updateAi({ apiKey: '' })}
                    className="ml-1 text-subtle underline-offset-2 hover:text-danger hover:underline"
                  >
                    {t('ai.clearKey')}
                  </button>
                </p>
              )}
            </div>
          </Row>
          <Row label={t('settings.ai.model')}>
            <div className="w-full max-w-[360px]">
              <div className="flex items-center gap-1.5">
                <select
                  aria-label={t('settings.ai.model')}
                  value={ai.model}
                  onChange={(event) => updateAi({ model: event.target.value })}
                  className="field min-w-0 flex-1 py-1.5 font-mono text-xs"
                >
                  {ai.model && !models.includes(ai.model) && <option value={ai.model}>{ai.model}</option>}
                  {models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                  {!ai.model && <option value="">{t('settings.ai.models.pick')}</option>}
                </select>
                <button
                  type="button"
                  onClick={() => void loadModels()}
                  disabled={!canFetchModels || modelsLoading}
                  className="btn btn-outline shrink-0 px-2.5 py-1.5 text-[11px] disabled:opacity-50"
                  title={!canFetchModels ? undefined : t('settings.ai.fetchModels')}
                >
                  {modelsLoading ? <Spinner size={11} /> : <RefreshCw size={11} />}
                  {modelsLoading ? t('settings.ai.fetchingModels') : t('settings.ai.fetchModels')}
                </button>
              </div>
              {modelsError && <p className="mt-1 break-words text-[10px] text-danger">{modelsError}</p>}
              {!modelsError && models.length > 0 && (
                <p className="mt-1 text-[10px] text-subtle">
                  {t('settings.ai.models.loaded', { n: models.length })}
                </p>
              )}
              {!modelsError && models.length === 0 && aiNeedsKey(ai) && (
                <p className="mt-1 text-[10px] text-subtle">{t('settings.ai.keyRequired')}</p>
              )}
            </div>
          </Row>
          <Row label={t('settings.ai.summaryLanguage')}>
            <select
              value={settings.aiLanguage}
              onChange={(event) => void saveSettings({ aiLanguage: event.target.value })}
              className="field w-auto py-1.5 text-xs"
            >
              {LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {code === 'auto' ? '跟随原文 / Auto' : languageLabel(code)}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('settings.ai.targetLanguage')}>
            <select
              value={settings.targetLanguage}
              onChange={(event) => void saveSettings({ targetLanguage: event.target.value })}
              className="field w-auto py-1.5 text-xs"
            >
              {TRANSLATE_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {languageLabel(code)}
                </option>
              ))}
            </select>
          </Row>
          <div className="flex flex-wrap items-center gap-2 pb-1 pt-2">
            <button
              type="button"
              onClick={() => void runAiTest()}
              disabled={testState.status === 'testing' || aiNeedsKey(ai)}
              className="btn btn-outline px-3 py-1.5 text-[11.5px] disabled:opacity-50"
            >
              {testState.status === 'testing' ? <Spinner size={11} /> : <RefreshCw size={11} />}
              {testState.status === 'testing' ? t('settings.ai.testing') : t('settings.ai.test')}
            </button>
            {testState.status === 'ok' && (
              <span className="flex items-center gap-1 text-[11px] text-success">
                <CheckCircle2 size={12} /> {t('settings.ai.ok')}
                {testState.message && <span className="text-subtle">· {testState.message}</span>}
              </span>
            )}
            {testState.status === 'fail' && (
              <span className="flex items-start gap-1 text-[11px] text-danger">
                <XCircle size={12} className="mt-px shrink-0" />
                <span className="max-w-[360px] break-words">{testState.message}</span>
              </span>
            )}
          </div>
          <p className="text-[10.5px] leading-relaxed text-subtle">
            {t('settings.ai.hint')}
            <br />
            {t('settings.ai.localHint')}
          </p>
        </Section>

        <Section title={t('settings.section.proxy')} icon={<Globe2 size={13} />}>
            <Switch
              checked={settings.proxy.enabled}
              onChange={(enabled) => updateProxy({ enabled })}
              label={t('settings.proxy.enable')}
              description={t('settings.proxy.enable.desc')}
            />
            {settings.proxy.enabled && (
              <>
                <Row label={t('settings.proxy.url')}>
                  <input
                    aria-label={t('settings.proxy.url')}
                    value={settings.proxy.url}
                    onChange={(event) => updateProxy({ url: event.target.value })}
                    placeholder={t('settings.proxy.url.placeholder')}
                    className="field w-full min-w-[240px] max-w-[320px] py-1.5 font-mono text-xs sm:w-[300px]"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </Row>
                {proxyInvalid && (
                  <p className="py-2 text-[10.5px] leading-relaxed text-danger">{t('settings.proxy.url.invalid')}</p>
                )}
                <Row label={t('settings.proxy.mode')}>
                  <Segmented
                    value={settings.proxy.mode}
                    onChange={(mode) => updateProxy({ mode })}
                    options={[
                      { value: 'all', label: t('settings.proxy.mode.all') },
                      { value: 'selected', label: t('settings.proxy.mode.selected') },
                    ]}
                  />
                </Row>
                <p className="py-2 text-[10.5px] leading-relaxed text-subtle">
                  {t(
                    settings.proxy.mode === 'all'
                      ? 'settings.proxy.mode.allDesc'
                      : 'settings.proxy.mode.selectedDesc',
                  )}
                </p>
              </>
            )}
          </Section>

          {!isTauri() && (
          <Section title={t('settings.section.server')} icon={<Server size={13} />}>
            <Row label={t('settings.server.url')} description={t('settings.server.hint')}>
              <div className="flex w-full max-w-[320px] items-center gap-1.5">
                <input
                  value={settings.apiBase}
                  onChange={(event) => void saveSettings({ apiBase: event.target.value })}
                  className="field w-full py-1.5 text-xs"
                  placeholder="http://127.0.0.1:8787"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => void runServerCheck()}
                  className="btn btn-outline shrink-0 px-2 py-1.5 text-[11px]"
                >
                  {serverState.status === 'testing' ? <Spinner size={11} /> : t('settings.server.check')}
                </button>
              </div>
            </Row>
            {serverState.status === 'ok' && (
              <p className="flex items-center gap-1 pb-2 text-[11px] text-success">
                <CheckCircle2 size={12} /> {t('settings.server.ok')}
                {serverState.message && <span className="text-subtle">· v{serverState.message}</span>}
              </p>
            )}
            {serverState.status === 'fail' && (
              <p className="flex items-center gap-1 pb-2 text-[11px] text-danger">
                <XCircle size={12} /> {t('settings.server.fail')} · {serverState.message}
              </p>
            )}
          </Section>
        )}

        <Section title={t('settings.section.data')} icon={<Download size={13} />}>
          <div className="py-2.5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-medium">{t('backup.title')}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{t('backup.note')}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button type="button" onClick={exportConfig} className="btn btn-outline px-2.5 py-1.5 text-[11px]">
                  <FileDown size={12} />
                  {t('backup.export')}
                </button>
                <button
                  type="button"
                  onClick={() => backupInputRef.current?.click()}
                  disabled={backupBusy}
                  className="btn btn-outline px-2.5 py-1.5 text-[11px] disabled:opacity-50"
                >
                  {backupBusy ? <Spinner size={11} /> : <FileUp size={12} />}
                  {t('backup.import')}
                </button>
                <input
                  ref={backupInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void importConfig(file)
                  }}
                />
              </div>
            </div>
            <label className="mt-2 flex items-start gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={includeKey}
                onChange={(event) => setIncludeKey(event.target.checked)}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>
                <span className="font-medium text-fg">{t('backup.includeKey')}</span>
                <span className="block text-[10.5px] leading-relaxed text-subtle">
                  {t('backup.includeKeyHint')}
                </span>
              </span>
            </label>
          </div>

          <div className="py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <OpmlImportButton className="!py-1.5 !text-[11.5px]" />
              <button
                type="button"
                onClick={exportOpml}
                className="btn btn-outline px-3 py-1.5 text-[11.5px]"
                disabled={feeds.length === 0}
              >
                <Upload size={12} />
                {t('settings.data.export')}
              </button>
              <button
                type="button"
                onClick={() => void refreshAll()}
                disabled={refreshing.running || feeds.length === 0}
                className="btn btn-outline px-3 py-1.5 text-[11.5px] disabled:opacity-50"
              >
                {refreshing.running ? <Spinner size={11} /> : <RefreshCw size={12} />}
                {t('settings.data.refresh')}
              </button>
              <button
                type="button"
                onClick={() => setClearConfirm(true)}
                disabled={feeds.length === 0 && articles.length === 0}
                className="btn px-3 py-1.5 text-[11.5px] text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                <Trash2 size={12} />
                {t('settings.data.clear')}
              </button>
            </div>
            <p className="mt-1 text-[10.5px] text-subtle">
              {t('settings.data.storage', { articles: articles.length, feeds: feeds.length })} · {folders.length} 分组
            </p>
          </div>

          <div className="py-2.5">
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <HardDrive size={14} />
                </span>
                <div>
                  <p className="text-[12.5px] font-medium">{t('storage.title')}</p>
                  <p className="text-[10.5px] text-subtle">
                    {t('storage.summary', {
                      articles: articles.length,
                      feeds: feeds.length,
                      folders: folders.length,
                    })}
                  </p>
                </div>
              </div>
              <span className="text-[10.5px] tabular-nums text-subtle">
                {storage && storage.quota > 0
                  ? t('storage.usage', { used: formatBytes(storage.usage), quota: formatBytes(storage.quota) })
                  : t('storage.unavailable')}
              </span>
            </div>
            {storage && storage.quota > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${Math.min(100, (storage.usage / storage.quota) * 100)}%` }}
                />
              </div>
            )}
            <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-subtle">
              <ShieldCheck size={11} className="mt-0.5 shrink-0 text-success" />
              {t('storage.localOnly')}
            </p>
            <p className="mt-1 flex items-center gap-1 text-[10.5px] text-success">
              <CheckCircle2 size={11} />
              {t('storage.autoSaved')}
            </p>
          </div>
        </Section>

        <Section title={t('settings.section.about')} icon={<Info size={13} />}>
          <div className="flex items-start gap-3 py-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft">
              <FeedIcon feed={{ id: 'flowread', title: 'F', iconUrl: '/favicon.svg' }} size={20} />
            </div>
            <div className="min-w-0 text-[11.5px] leading-relaxed text-muted">
              <p className="font-medium text-fg">FlowRead v{VERSION}</p>
              <p className="mt-0.5">{t('settings.about.desc')}</p>
              <p className={cn('mt-1 text-[10.5px] text-subtle')}>{t('settings.about.tech')}</p>
            </div>
          </div>
        </Section>

        {refreshing.running && (
          <div className="fixed bottom-16 right-6 z-10 flex items-center gap-2 rounded-full border border-line bg-elevated px-3 py-1.5 text-[11px] text-muted shadow-lg">
            <Loader2 size={12} className="animate-spin text-accent" />
            {t('refresh.progress', { done: refreshing.done, total: refreshing.total })}
          </div>
        )}
      </div>
      </Modal>
      <ConfirmDialog
        open={clearConfirm}
        title={t('settings.data.clear')}
        message={t('settings.data.clearConfirm')}
        confirmLabel={t('settings.data.clear')}
        onClose={() => setClearConfirm(false)}
        onConfirm={() => {
          setClearConfirm(false)
          void clearData()
        }}
      />
    </>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">
        {icon}
        {title}
      </h3>
      <div className="divide-y divide-line/70 rounded-xl border border-line px-3.5">{children}</div>
    </section>
  )
}

function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <span className="block text-[13.5px] font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{description}</span>}
      </div>
      <div className="shrink-0 sm:max-w-[60%]">{children}</div>
    </div>
  )
}
