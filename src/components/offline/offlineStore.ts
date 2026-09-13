/**
 * Whether the figures on screen came from the device, and whether an edit just
 * failed for want of a network.
 *
 * A store, like `screen/pageTitle.ts`, because both facts arrive from outside
 * React — a service-worker message, the page's own render time read before
 * hydration, a failed mutation in the query client — and `OfflineBanner` reads
 * them back with `useSyncExternalStore`.
 */
import { useSyncExternalStore } from 'react'
import { isSavedCopyMessage, RENDERED_AT_META, savedPageTime } from '~/lib/offline/messages'
import { isSavedCopyCache } from '~/lib/offline/policy'

export interface OfflineState {
  /** The oldest saved copy behind the current screen; null while all of it is live. */
  savedAt: number | null
  /** Set for a few seconds after an edit fails because no server answered. */
  nothingSaved: 'offline' | 'unreachable' | null
}

const LIVE: OfflineState = { savedAt: null, nothingSaved: null }
const NOTICE_MS = 8000

let state: OfflineState = LIVE
let noticeTimer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

/** A new object only when something changed — `useSyncExternalStore` compares by identity. */
function set(next: OfflineState): void {
  if (next.savedAt === state.savedAt && next.nothingSaved === state.nothingSaved) return
  state = next
  for (const listener of listeners) listener()
}

export function subscribeOffline(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getOffline = (): OfflineState => state

/** The server only ever renders live figures. */
export const getServerOffline = (): OfflineState => LIVE

/** Keeps the oldest: the banner has to cover the most out-of-date figure on screen. */
export function noteSavedCopy(savedAt: number): void {
  set({ ...state, savedAt: state.savedAt === null ? savedAt : Math.min(state.savedAt, savedAt) })
}

export function resetSavedCopy(): void {
  set({ ...state, savedAt: null })
}

export function noteNothingSaved(reason: 'offline' | 'unreachable'): void {
  set({ ...state, nothingSaved: reason })
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    set({ ...state, nothingSaved: null })
  }, NOTICE_MS)
}

/**
 * Starts listening. Called once from the client entry, before hydration.
 *
 * Before, because the page's own age has to be read from the document the
 * server rendered, and the first loader may be answered from a saved copy
 * before any component has mounted to hear about it.
 */
export function startOfflineListener(): void {
  const marker = document.querySelector<HTMLMetaElement>(`meta[name="${RENDERED_AT_META}"]`)
  const renderedAt = marker ? Number(marker.content) : Number.NaN
  const savedAt = Number.isFinite(renderedAt) ? savedPageTime(renderedAt, Date.now()) : null
  if (savedAt !== null) noteSavedCopy(savedAt)

  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data: unknown = event.data
    if (isSavedCopyMessage(data)) noteSavedCopy(data.savedAt)
  })
}

/**
 * Installs the worker, in production builds only.
 *
 * Deferred to `load` so that installing — which downloads the whole build for
 * the precache — never competes with the first render.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('[offline] service worker registration failed', error)
    })
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}

/**
 * Removes every saved figure from the device.
 *
 * Deletes the caches directly rather than asking the worker, because it has to
 * work with no worker running, with no network, and before sign-out has
 * finished — the point is that nothing is left behind if the rest fails.
 */
export async function clearSavedCopies(): Promise<void> {
  if (!('caches' in globalThis)) return
  const names = await caches.keys()
  await Promise.all(names.filter(isSavedCopyCache).map((name) => caches.delete(name)))
  resetSavedCopy()
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/** The browser's own online flag. The server renders as online. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  )
}
