import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Store SW registration for on-demand update checks
let swRegistration: ServiceWorkerRegistration | undefined

registerSW({
  onRegisteredSW(_swUrl, registration) {
    swRegistration = registration
  },
})

// Reload when a new SW takes control
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  window.location.reload()
})

/**
 * Check for SW update. Returns true if a new version is waiting/installing
 * (the controllerchange listener will handle the reload).
 */
export async function checkForUpdate(): Promise<boolean> {
  if (!swRegistration) return false
  await swRegistration.update()
  return !!(swRegistration.waiting || swRegistration.installing)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
