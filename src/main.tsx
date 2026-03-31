import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Check for SW updates every 60 seconds (important for iOS PWA)
const updateSW = registerSW({
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      setInterval(() => { registration.update() }, 60 * 1000)
    }
  },
})

// Reload when a new SW takes control (covers autoUpdate activation)
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
