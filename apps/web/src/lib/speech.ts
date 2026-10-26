import { useSyncExternalStore } from 'react'
import type { Article } from '../types'
import { plainText } from './utils'

export type SpeechStatus = 'idle' | 'playing' | 'paused'

export interface SpeechState {
  articleId?: string
  status: SpeechStatus
  supported: boolean
}

const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
let state: SpeechState = { status: 'idle', supported }
const listeners = new Set<() => void>()
let queue: SpeechSynthesisUtterance[] = []

function emit(): void {
  for (const listener of listeners) listener()
}

function setState(next: SpeechState): void {
  state = next
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): SpeechState {
  return state
}

/** Reactive speech-synthesis state shared by every "listen" button. */
export function useSpeechState(): SpeechState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function detectLanguage(text: string): string {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length
  return cjk > text.length * 0.15 ? 'zh-CN' : 'en-US'
}

function chunkText(text: string, maxLength = 220): string[] {
  const sentences = text.match(/[^。！？.!?\n]+[。！？.!?]?/g) ?? [text]
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (!trimmed) continue
    if (current && current.length + trimmed.length > maxLength) {
      chunks.push(current)
      current = ''
    }
    if (trimmed.length > maxLength) {
      for (let index = 0; index < trimmed.length; index += maxLength) {
        chunks.push(trimmed.slice(index, index + maxLength))
      }
    } else {
      current += trimmed
    }
  }
  if (current) chunks.push(current)
  return chunks.slice(0, 120)
}

function articleText(article: Article): string {
  const html = article.extractedHtml ?? article.contentHtml
  const text = plainText(html)
  return `${article.title}。${text}`.slice(0, 30_000)
}

/** Start reading an article aloud, or stop it if it is already playing. */
export function toggleSpeech(article: Article): void {
  if (!supported) return
  if (state.articleId === article.id && state.status === 'playing') {
    stopSpeech()
    return
  }
  startSpeech(article)
}

export function startSpeech(article: Article): void {
  if (!supported) return
  window.speechSynthesis.cancel()
  queue = []
  const text = articleText(article).trim()
  if (!text) return

  const lang = detectLanguage(text)
  const chunks = chunkText(text)
  queue = chunks.map((chunk) => {
    const utterance = new SpeechSynthesisUtterance(chunk)
    utterance.lang = lang
    utterance.rate = 1
    return utterance
  })
  const total = queue.length
  queue.forEach((utterance, index) => {
    utterance.onend = () => {
      if (index === total - 1) {
        queue = []
        setState({ status: 'idle', supported })
      }
    }
    utterance.onerror = () => {
      if (index === total - 1) {
        queue = []
        setState({ status: 'idle', supported })
      }
    }
  })

  setState({ articleId: article.id, status: 'playing', supported })
  for (const utterance of queue) window.speechSynthesis.speak(utterance)
}

export function stopSpeech(): void {
  if (!supported) return
  window.speechSynthesis.cancel()
  queue = []
  setState({ status: 'idle', supported })
}
