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
