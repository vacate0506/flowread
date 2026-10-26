const LABELS: Record<string, string> = {
  auto: '跟随原文 / Auto',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
}

export function languageLabel(code: string): string {
  return LABELS[code] ?? code
}

export const LANGUAGE_CODES = Object.keys(LABELS)
