import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { setSwRegistration } from './swUpdate'
import './index.css'
import App from './App.tsx'

registerSW({
  onRegisteredSW(_swUrl, registration) {
    setSwRegistration(registration)
  },
})

// Reload when a new SW takes control
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
