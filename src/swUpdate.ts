// SW registration state shared between main.tsx and App.tsx
let swRegistration: ServiceWorkerRegistration | undefined

const UPDATE_COOLDOWN_KEY = 'flip-last-update-check'
const COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24 hours

export function setSwRegistration(reg: ServiceWorkerRegistration | undefined) {
  swRegistration = reg
}

/**
 * Check for SW update. Returns true if a new version is waiting/installing
 * (the controllerchange listener will handle the reload).
 * Skips check if an update was found within the last 24 hours.
 */
export async function checkForUpdate(): Promise<boolean> {
  if (!swRegistration) return false

  // Skip if checked recently
  const lastCheck = localStorage.getItem(UPDATE_COOLDOWN_KEY)
  if (lastCheck && Date.now() - Number(lastCheck) < COOLDOWN_MS) {
    return false
  }

  await swRegistration.update()
  const hasUpdate = !!(swRegistration.waiting || swRegistration.installing)

  if (hasUpdate) {
    localStorage.setItem(UPDATE_COOLDOWN_KEY, String(Date.now()))
  }

  return hasUpdate
}

/**
 * Force-refresh past a stale PWA cache: drop the update cooldown, delete every
 * Cache Storage entry (the precached app shell), unregister all service workers,
 * then hard-reload from the network. Used by the "スーパーリロード" menu item.
 */
export async function superReload(): Promise<void> {
  try {
    localStorage.removeItem(UPDATE_COOLDOWN_KEY)

    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }

    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
  } catch {
    // Best-effort cleanup; reload regardless so the user isn't left stuck.
  } finally {
    // Cache-busting navigation so even the HTML document is refetched.
    const url = new URL(window.location.href)
    url.searchParams.set('_sr', String(Date.now()))
    window.location.replace(url.toString())
  }
}
