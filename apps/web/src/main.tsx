import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Tauri Android applies the system bar insets natively (MainActivity); mark the
// page so the web headers don't add the same safe-area padding twice.
if (
  Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) &&
  /Android/i.test(navigator.userAgent)
) {
  document.documentElement.classList.add('android-tauri')
}

const container = document.getElementById('root')
if (!container) throw new Error('Root container missing')

createRoot(container).render(<App />)

// Register the service worker only for the plain web/PWA target (not Tauri,
// Electron or Capacitor, where the shell already serves assets locally).
const isEmbedded =
  Boolean((window as { Capacitor?: unknown }).Capacitor) ||
  Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) ||
  navigator.userAgent.includes('Electron')
if (import.meta.env.PROD && 'serviceWorker' in navigator && !isEmbedded) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}
