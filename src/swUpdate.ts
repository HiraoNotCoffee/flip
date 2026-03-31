// SW registration state shared between main.tsx and App.tsx
let swRegistration: ServiceWorkerRegistration | undefined

export function setSwRegistration(reg: ServiceWorkerRegistration | undefined) {
  swRegistration = reg
}

/**
 * Check for SW update. Returns true if a new version is waiting/installing
 * (the controllerchange listener will handle the reload).
 */
export async function checkForUpdate(): Promise<boolean> {
  if (!swRegistration) return false
  await swRegistration.update()
  return !!(swRegistration.waiting || swRegistration.installing)
}
