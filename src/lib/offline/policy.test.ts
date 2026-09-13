import { describe, expect, it } from 'vitest'
import {
  cacheNames,
  isExpired,
  isOwnCache,
  isSavedCopyCache,
  MAX_SAVED_AGE_MS,
  SAVED_AT_HEADER,
  savedAtOf,
  shouldSave,
  stamp,
  strategyFor,
} from './policy'

const ORIGIN = 'https://pnl.example.com'
const request = (
  path: string,
  { method = 'GET', mode = 'cors' }: { method?: string; mode?: RequestMode } = {},
) => ({
  method,
  mode,
  url: path.startsWith('http') ? path : `${ORIGIN}${path}`,
})

describe('strategyFor', () => {
  it('saves pages and GET server functions, network first', () => {
    expect(strategyFor(request('/positions?scope=NISA', { mode: 'navigate' }), ORIGIN)).toBe('page')
    expect(strategyFor(request('/_serverFn/abc123?payload=%7B%7D'), ORIGIN)).toBe('data')
  })

  it('serves hashed build files from the precache', () => {
    expect(strategyFor(request('/assets/index-AbCd1234.js'), ORIGIN)).toBe('asset')
  })

  it('never intercepts a write', () => {
    // Every edit in the app is a POST server function.
    expect(strategyFor(request('/_serverFn/abc123', { method: 'POST' }), ORIGIN)).toBe('passthrough')
  })

  it('never intercepts the auth endpoints or the webhook', () => {
    expect(strategyFor(request('/api/auth/get-session'), ORIGIN)).toBe('passthrough')
    // The OAuth callback is a navigation, and still must reach the server untouched.
    expect(
      strategyFor(request('/api/auth/callback/google?code=x', { mode: 'navigate' }), ORIGIN),
    ).toBe('passthrough')
    expect(strategyFor(request('/api/tv/secret', { method: 'POST' }), ORIGIN)).toBe('passthrough')
  })

  it('leaves other origins alone', () => {
    expect(
      strategyFor(request('https://accounts.google.com/o/oauth2/auth', { mode: 'navigate' }), ORIGIN),
    ).toBe('passthrough')
  })

  it('leaves files that are not a screen to the browser', () => {
    for (const path of ['/robots.txt', '/manifest.webmanifest', '/sw.js', '/favicon.ico']) {
      expect(strategyFor(request(path), ORIGIN)).toBe('passthrough')
    }
  })
})

describe('shouldSave', () => {
  const ok = { status: 200, type: 'basic', redirected: false } as const

  it('saves a plain successful response', () => {
    expect(shouldSave(request('/positions'), ok)).toBe(true)
  })

  it('refuses an error, which would replace good figures with a failure', () => {
    expect(shouldSave(request('/positions'), { ...ok, status: 500 })).toBe(false)
  })

  it('refuses a redirect in either form, so sign-in is never filed under a screen', () => {
    expect(shouldSave(request('/positions'), { ...ok, status: 0, type: 'opaqueredirect' })).toBe(false)
    expect(shouldSave(request('/positions'), { ...ok, redirected: true })).toBe(false)
  })

  it('never saves the sign-in page', () => {
    expect(shouldSave(request('/signin'), ok)).toBe(false)
  })
})

describe('stamp and savedAtOf', () => {
  it('keeps the body and headers, and adds the time it was saved', async () => {
    const original = new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-encoding': 'br' },
    })

    const saved = await stamp(original, 1_789_000_000_000)

    expect(savedAtOf(saved)).toBe(1_789_000_000_000)
    expect(await saved.text()).toBe('{"ok":true}')
    expect(saved.headers.get('content-type')).toBe('application/json')
    // The body read back is already decoded.
    expect(saved.headers.get('content-encoding')).toBeNull()
  })

  it('reads no time from a response without a usable stamp', () => {
    expect(savedAtOf(new Response('x'))).toBeNull()
    expect(savedAtOf(new Response('x', { headers: { [SAVED_AT_HEADER]: 'soon' } }))).toBeNull()
  })
})

describe('isExpired', () => {
  it('keeps a copy for thirty days and not a millisecond longer', () => {
    const savedAt = 1_789_000_000_000
    expect(isExpired(savedAt, savedAt + MAX_SAVED_AGE_MS)).toBe(false)
    expect(isExpired(savedAt, savedAt + MAX_SAVED_AGE_MS + 1)).toBe(true)
  })
})

describe('cache names', () => {
  it('scopes both caches to the build', () => {
    expect(cacheNames('abc')).toEqual({ assets: 'pnl-assets-abc', saved: 'pnl-saved-abc' })
  })

  it('recognises saved figures from any build, and only this app’s caches', () => {
    expect(isSavedCopyCache(cacheNames('old').saved)).toBe(true)
    expect(isSavedCopyCache(cacheNames('old').assets)).toBe(false)
    expect(isOwnCache(cacheNames('old').assets)).toBe(true)
    expect(isOwnCache('workbox-precache-v2')).toBe(false)
  })
})
