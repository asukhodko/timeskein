import { useEffect } from 'react'
import { logAppEvent } from './api/client'
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
    void logAppEvent({
      source: 'ui',
      kind: 'app_started',
    })
  }, [])

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
        void logAppEvent({
          source: 'ui',
          kind: 'window_hide_requested',
          payload: {
            control: 'escape',
          },
        })
        void logAppEvent({
          source: 'ui',
          kind: 'window_hidden',
          payload: {
            control: 'escape',
          },
        })
        void tauriWindow.hide()
      }

      const handleVisibilityChange = () => {
        void logAppEvent({
          source: 'ui',
          kind: document.hidden ? 'window_hidden' : 'window_shown',
          payload: {
            control: 'visibilitychange',
          },
        })
      }

      document.addEventListener('keydown', handleKeyDown)
      document.addEventListener('visibilitychange', handleVisibilityChange)

      cleanup = () => {
        document.removeEventListener('keydown', handleKeyDown)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
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
