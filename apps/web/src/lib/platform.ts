/** Runtime helpers that bridge the web build and the Tauri desktop shell. */

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  const candidate = window as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }
  return Boolean(candidate.__TAURI_INTERNALS__ ?? candidate.__TAURI__)
}

export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

/** Android build of the Tauri app – some desktop interactions are disabled there. */
export function isTauriAndroid(): boolean {
  return isTauri() && isAndroid()
}

/** Open a URL in the system browser (Tauri) or a new tab (web). */
export async function openExternal(url: string): Promise<void> {
  if (!url) return
  if (isTauri()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
      return
    } catch {
      /* fall through to window.open */
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

export async function tauriChannel<T>(): Promise<(onMessage: (message: T) => void) => unknown> {
  const { Channel } = await import('@tauri-apps/api/core')
  const channel = new Channel<T>()
  return (onMessage: (message: T) => void) => {
    channel.onmessage = onMessage
    return channel
  }
}
