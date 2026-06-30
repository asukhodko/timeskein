import { useEffect } from 'react'
import Palette from './components/Palette'

type TauriWindow = Window &
  typeof globalThis & {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }

function isTauriRuntime() {
  const tauriWindow = window as TauriWindow

  return Boolean(
    tauriWindow.__TAURI__ ||
      tauriWindow.__TAURI_INTERNALS__ ||
      window.location.protocol === 'tauri:' ||
      window.location.hostname === 'tauri.localhost'
  )
}

function App() {
  useEffect(() => {
    if (!isTauriRuntime()) return

    let cancelled = false
    let cleanup: (() => void) | undefined

    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      if (cancelled) return

      const tauriWindow = getCurrentWindow()
      const unlisten = tauriWindow.onFocusChanged(() => {
        // Focus tracking for future use.
      })

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return
        if (document.querySelector('[data-timeskein-modal="true"]')) return

        e.preventDefault()
        void tauriWindow.hide()
      }

      document.addEventListener('keydown', handleKeyDown)

      cleanup = () => {
        document.removeEventListener('keydown', handleKeyDown)
        void unlisten.then((fn) => fn())
      }
    }).catch((error) => {
      if (!cancelled) {
        console.warn('Unable to initialize Timeskein window shortcuts', error)
      }
    })

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-900/95 backdrop-blur-sm rounded-lg border border-gray-700 shadow-2xl overflow-hidden">
      <Palette />
    </div>
  )
}

export default App
