import { useEffect } from 'react'
import Palette from './components/Palette'

// Check if running inside Tauri
const isTauri = () => '__TAURI__' in window

function App() {
  useEffect(() => {
    // Tauri-specific window handling
    if (isTauri()) {
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        const tauriWindow = getCurrentWindow()
        
        const unlisten = tauriWindow.onFocusChanged(() => {
          // Focus tracking for future use
        })

        const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            tauriWindow.hide()
          }
        }

        document.addEventListener('keydown', handleKeyDown)

        return () => {
          unlisten.then(fn => fn())
          document.removeEventListener('keydown', handleKeyDown)
        }
      })
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-900/95 backdrop-blur-sm rounded-lg border border-gray-700 shadow-2xl overflow-hidden">
      <Palette />
    </div>
  )
}

export default App
