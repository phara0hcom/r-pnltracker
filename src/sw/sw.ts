/**
 * The service worker: the app's precache and its offline copy of each screen.
 *
 * Event glue only. What is saved, what is never touched, and how long a copy
 * lives are decided in `lib/offline/policy.ts`, where they are tested — read
 * that first.
 *
 * Built by the `serviceWorker()` plugin in `vite.config.ts`, which bundles this
 * file on its own and defines the two constants below from the client build it
 * is emitted into. Not registered under `npm run dev`; try it with
 * `npm run build && npm start`.
 */
import type { SavedCopyMessage } from '~/lib/offline/messages'
import { offlinePageHtml } from '~/lib/offline/offlinePage'
import {
  cacheNames,
  isExpired,
  isOwnCache,
  savedAtOf,
  shouldSave,
  stamp,
  strategyFor,
} from '~/lib/offline/policy'

declare const self: ServiceWorkerGlobalScope
/** Every hashed file in the client build, as root-relative URLs. */
declare const __PNL_PRECACHE__: string[]
/** Changes whenever the app's code does, and with it every cache name. */
declare const __PNL_BUILD__: string

const CACHES = cacheNames(__PNL_BUILD__)

/** Whether this run of the worker has swept expired copies yet — see `discardExpired`. */
let swept = false

interface SavedCopy {
  response: Response
  savedAt: number
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHES.assets)
      // All of it, so a screen never opened online still has its code offline.
      await cache.addAll(__PNL_PRECACHE__)
      // Take over at once rather than when every tab has closed: a page from the
      // previous build keeps working from the network either way.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const current = new Set([CACHES.assets, CACHES.saved])
      // The previous build's saved copies go with its assets — see `cacheNames`.
      const stale = (await caches.keys()).filter((name) => isOwnCache(name) && !current.has(name))
      await Promise.all(stale.map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request, self.location.origin)
  switch (strategy) {
    case 'passthrough':
      return
    case 'asset':
      event.respondWith(fromPrecache(event.request))
      return
    case 'page':
    case 'data':
      if (!swept) {
        swept = true
        event.waitUntil(discardExpired())
      }
      event.respondWith(networkThenSaved(event, strategy))
      return
  }
})

/** A hashed file never changes, so the precache is authoritative when it has one. */
async function fromPrecache(request: Request): Promise<Response> {
  return (await caches.match(request, { cacheName: CACHES.assets })) ?? fetch(request)
}

/**
 * The network's answer, saved for later; the saved copy only when there is no answer.
 *
 * An error *response* is returned like any other. Only a fetch that rejects —
 * no response at all — falls back, because a server that answered 500 was up,
 * and its answer is the truth about the figures.
 *
 * A saved page goes back exactly as it was saved. It already says when it was
 * rendered, which is how the page itself tells that it is not live — see
 * `savedPageTime`. Data has nowhere to say so, so the page is told instead.
 */
async function networkThenSaved(event: FetchEvent, strategy: 'page' | 'data'): Promise<Response> {
  const { request } = event

  let response: Response
  try {
    response = await fetch(request)
  } catch (error) {
    const saved = await savedCopy(request)
    if (strategy === 'page') return saved?.response ?? offlinePage()
    if (!saved) throw error
    event.waitUntil(tell(event.clientId, saved.savedAt))
    return saved.response
  }

  if (shouldSave(request, response)) {
    event.waitUntil(save(request, response.clone()))
  }
  return response
}

async function save(request: Request, response: Response): Promise<void> {
  const cache = await caches.open(CACHES.saved)
  await cache.put(request, await stamp(response, Date.now()))
}

async function savedCopy(request: Request): Promise<SavedCopy | null> {
  const cache = await caches.open(CACHES.saved)
  // The copy answers the same URL. A `Vary` naming a header this request lacks
  // would otherwise hide it for no reason that matters here.
  const response = await cache.match(request, { ignoreVary: true })
  if (!response) return null

  const savedAt = savedAtOf(response)
  if (savedAt === null || isExpired(savedAt, Date.now())) {
    await cache.delete(request, { ignoreVary: true })
    return null
  }
  return { response, savedAt }
}

function offlinePage(): Response {
  return new Response(offlinePageHtml(), {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Tells the page that asked that its data came from the saved copy. */
async function tell(clientId: string, savedAt: number): Promise<void> {
  const client = await self.clients.get(clientId)
  const message: SavedCopyMessage = { type: 'pnl:saved-copy', savedAt }
  client?.postMessage(message)
}

/**
 * Deletes every saved copy past its age, whether or not anything asks for it.
 *
 * Reading already refuses an expired copy, but that alone would leave one on
 * the device indefinitely if its screen were never opened again. Run on the
 * first page or data request each time the worker starts — which is every time
 * the app is opened after the browser has idled the worker — so nothing older
 * than the limit outlives the next visit.
 */
async function discardExpired(): Promise<void> {
  const cache = await caches.open(CACHES.saved)
  const now = Date.now()
  for (const request of await cache.keys()) {
    const response = await cache.match(request)
    const savedAt = response ? savedAtOf(response) : null
    if (savedAt === null || isExpired(savedAt, now)) await cache.delete(request)
  }
}
