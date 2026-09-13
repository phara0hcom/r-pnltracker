/**
 * End-to-end check of the installed app's offline behaviour: the built service
 * worker, served from `.output`, in a real Chromium.
 *
 * `npm run check:offline` builds first. It is separate from `npm test` for the
 * reason `test:db` is — it needs a build, `.env` and a browser, and takes tens
 * of seconds. The unit tests pin `src/lib/offline/policy.ts`; only a browser
 * shows the worker applying it, so run this after touching `src/sw/`,
 * `src/lib/offline/` or the `serviceWorker()` plugin.
 *
 * "Offline" is the server process stopped mid-run, so every failure is a real
 * refused connection rather than a simulated one. Needs
 * `npx playwright install chromium` once.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SERVER_DIR = join(ROOT, '.output/server')
const PORT = '3100'
const BASE = `http://localhost:${PORT}`

// What the client stub sends, so the worker sees the request the app makes.
const SERVER_FN_HEADERS = {
  'x-tsr-serverFn': 'true',
  accept: 'application/x-tss-framed, application/x-ndjson, application/json',
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

/**
 * The one GET server function that answers without a session, found in the
 * server bundle rather than written here: its ID is a hash the build derives,
 * and a hardcoded one would break the first time it changed.
 */
function findServerFn(name) {
  const pattern = new RegExp(
    `\\b${name} = createServerFn\\(\\{ method: "GET" \\}\\)[^;]*?createSsrRpc\\("([0-9a-f]{64})"`,
  )
  for (const file of readdirSync(SERVER_DIR, { recursive: true })) {
    if (!file.endsWith('.mjs') || file.includes('node_modules')) continue
    const match = pattern.exec(readFileSync(join(SERVER_DIR, file), 'utf8'))
    if (match) return `/_serverFn/${match[1]}`
  }
  return fail(`${name} is not in the server bundle as a GET server function — has it changed?`)
}

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function startServer() {
  return spawn('node', ['--env-file=.env', '.output/server/index.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT, NITRO_PORT: PORT },
    stdio: 'ignore',
  })
}

async function reachable() {
  try {
    return (await fetch(`${BASE}/robots.txt`)).ok
  } catch {
    return false
  }
}

async function waitFor(condition, what) {
  for (let i = 0; i < 100; i++) {
    if (await condition()) return
    await sleep(200)
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function stopServer(child) {
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  await exited
  await waitFor(async () => !(await reachable()), 'the server to stop')
}

if (!existsSync(join(SERVER_DIR, 'index.mjs'))) fail('No build in .output — run `npm run build` first.')
if (!existsSync(join(ROOT, '.env'))) fail('No .env — the server needs it to render a page.')
if (await reachable()) fail(`Something is already listening on :${PORT}.`)
const SESSION_FN = findServerFn('getSessionUser')

let server = startServer()
await waitFor(reachable, 'the server to start')
const browser = await chromium.launch()

try {
  const context = await browser.newContext()
  const page = await context.newPage()

  // ── Online: the worker script, the manifest and the icons ─────────────────
  const sw = await context.request.get(`${BASE}/sw.js`)
  check('sw.js is served', sw.status() === 200, String(sw.status()))
  const swCaching = sw.headers()['cache-control'] ?? ''
  check('sw.js is not HTTP-cached', swCaching.includes('no-cache'), swCaching)

  const manifest = await context.request.get(`${BASE}/manifest.webmanifest`)
  const manifestType = manifest.headers()['content-type'] ?? ''
  check('the manifest has its content type', manifestType.includes('manifest+json'), manifestType)
  const { start_url: startUrl, display } = await manifest.json()
  check('the app starts at the dashboard, standalone', startUrl === '/dashboard' && display === 'standalone')

  for (const icon of [
    '/favicon.ico',
    '/favicon.svg',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-maskable-512.png',
    '/icons/apple-touch-icon.png',
  ]) {
    const response = await context.request.get(BASE + icon)
    check(`${icon} is served`, response.status() === 200, String(response.status()))
  }

  // ── Every page carries its render time, and hydrates cleanly ──────────────
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.goto(`${BASE}/signin`)
  await page.waitForLoadState('networkidle')

  const head = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        'link[rel="manifest"], link[rel="icon"], link[rel="apple-touch-icon"], meta[name="theme-color"]',
      ),
    ].map((el) => el.getAttribute('href') ?? el.getAttribute('content')),
  )
  const expectedHead = ['/manifest.webmanifest', '/favicon.svg', '/favicon.ico', '/icons/apple-touch-icon.png', '#0b0d10']
  check('the head links the manifest, icons and theme colour', expectedHead.every((href) => head.includes(href)), head.join(' '))

  const renderedAt = Number(
    await page.evaluate(() => document.querySelector('meta[name="pnl-rendered-at"]')?.getAttribute('content')),
  )
  check('the page carries the time the server rendered it', Math.abs(Date.now() - renderedAt) < 60_000, String(renderedAt))
  const mismatches = consoleErrors.filter((text) => /hydrat/i.test(text))
  check('and hydrates without a mismatch', mismatches.length === 0, mismatches.join(' | '))

  // ── The worker installs, precaches the build and takes control ────────────
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 })
  const cacheSizes = await page.evaluate(async () => {
    const sizes = {}
    for (const name of await caches.keys()) sizes[name] = (await (await caches.open(name)).keys()).length
    return sizes
  })
  const assetCache = Object.keys(cacheSizes).find((name) => name.startsWith('pnl-assets-'))
  check('the whole build is precached', assetCache !== undefined && cacheSizes[assetCache] > 50, JSON.stringify(cacheSizes))
  if (assetCache === undefined) throw new Error('no precache — nothing further can be checked')
  const savedCache = `pnl-saved-${assetCache.slice('pnl-assets-'.length)}`

  // ── A real server function response is saved as it was served ─────────────
  // The sign-in page wipes saved copies as it renders; let that finish first.
  await sleep(1000)
  const live = await page.evaluate(
    async ({ url, headers }) => {
      const response = await fetch(url, { headers })
      return { status: response.status, body: await response.text() }
    },
    { url: SESSION_FN, headers: SERVER_FN_HEADERS },
  )
  check('the real server function answers', live.status === 200, `${live.status} ${live.body.slice(0, 80)}`)

  // Saved in `waitUntil`, after the response has already been returned.
  await sleep(1500)
  const stored = await page.evaluate(async (url) => {
    for (const name of await caches.keys()) {
      if (!name.startsWith('pnl-saved-')) continue
      const response = await (await caches.open(name)).match(location.origin + url, { ignoreVary: true })
      if (response) {
        return {
          savedAt: Number(response.headers.get('x-pnl-saved-at')),
          headers: [...response.headers.keys()],
          body: await response.text(),
        }
      }
    }
    return null
  }, SESSION_FN)
  check('the worker saved it', stored !== null)
  check('stamped with the time it was saved', stored !== null && Math.abs(Date.now() - stored.savedAt) < 30_000, String(stored?.savedAt))
  check('with the body exactly as served', stored?.body === live.body)
  const dropped = ['set-cookie', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive']
  check(
    'and no cookie, encoding or connection header kept',
    stored !== null && !stored.headers.some((name) => dropped.includes(name)),
    stored?.headers.join(','),
  )

  // ── Seed saved copies a signed-in visit would have left ───────────────────
  const hourAgo = Date.now() - 3_600_000
  await page.evaluate(
    async ({ savedCache, hourAgo }) => {
      const cache = await caches.open(savedCache)
      const stamped = (savedAt, type) => ({ headers: { 'content-type': type, 'x-pnl-saved-at': String(savedAt) } })
      const savedPage = `<!DOCTYPE html><html lang="en"><head><meta name="pnl-rendered-at" content="${hourAgo}"><title>saved</title></head><body><p>saved positions</p></body></html>`
      await cache.put(`${location.origin}/positions`, new Response(savedPage, stamped(hourAgo, 'text/html')))
      await cache.put(`${location.origin}/_serverFn/check?payload=1`, new Response('{"saved":true}', stamped(hourAgo, 'application/json')))
      const monthAgo = Date.now() - 31 * 86_400_000
      await cache.put(`${location.origin}/tax`, new Response('<html><body>too old</body></html>', stamped(monthAgo, 'text/html')))
    },
    { savedCache, hourAgo },
  )

  // ── Offline: stop the server ──────────────────────────────────────────────
  await stopServer(server)
  server = undefined

  // Reads a request back from the worker, with the saved time it announces.
  const readOffline = (url, headers = {}) =>
    page.evaluate(
      async ({ url, headers }) => {
        const message = new Promise((resolve) => {
          navigator.serviceWorker.addEventListener('message', (event) => resolve(event.data), { once: true })
          setTimeout(() => resolve(null), 3000)
        })
        const body = await fetch(url, { headers }).then(
          (response) => response.text(),
          (error) => `error: ${error.message}`,
        )
        return { body, message: await message }
      },
      { url, headers },
    )

  const real = await readOffline(SESSION_FN, SERVER_FN_HEADERS)
  check('offline, the real request gets the saved response', real.body === live.body, real.body.slice(0, 80))
  check(
    'and the page is told when it was saved',
    real.message?.type === 'pnl:saved-copy' && real.message.savedAt === stored?.savedAt,
    JSON.stringify(real.message),
  )

  const seeded = await readOffline('/_serverFn/check?payload=1')
  check('a seeded copy is answered too', seeded.body === '{"saved":true}', seeded.body)
  check('with its own saved time', seeded.message?.savedAt === hourAgo, JSON.stringify(seeded.message))

  const unsaved = await page.evaluate(() =>
    fetch('/_serverFn/never?payload=1').then(
      () => 'resolved',
      (error) => `rejected ${error.name}`,
    ),
  )
  check('data never saved fails as a network error', unsaved === 'rejected TypeError', unsaved)

  const write = await page.evaluate(() =>
    fetch('/_serverFn/check?payload=1', { method: 'POST', body: '{}' }).then(
      (response) => `resolved ${response.status}`,
      (error) => `rejected ${error.name}`,
    ),
  )
  check('a write is never answered from the cache', write.startsWith('rejected'), write)

  await page.goto(`${BASE}/positions`)
  const positions = await page.evaluate(() => ({
    text: document.body.innerText,
    renderedAt: document.querySelector('meta[name="pnl-rendered-at"]')?.getAttribute('content') ?? null,
  }))
  check('a saved page opens with no server', positions.text.includes('saved positions'), positions.text.slice(0, 60))
  check('with the render time the server gave it, for the banner', positions.renderedAt === String(hourAgo), String(positions.renderedAt))

  await page.goto(`${BASE}/tax`)
  const tax = await page.content()
  check('an expired copy is not shown', !tax.includes('too old') && tax.includes('You’re offline'))

  await page.goto(`${BASE}/stats`)
  check('a screen never saved gets the offline page', (await page.content()).includes('hasn’t been saved on this device yet'))

  // ── Back online: the sign-in page wipes saved copies, keeps the precache ──
  server = startServer()
  await waitFor(reachable, 'the server to restart')
  await page.goto(`${BASE}/signin`)
  await sleep(1500)
  const after = await page.evaluate(() => caches.keys())
  check('the sign-in page wipes every saved copy', !after.some((name) => name.startsWith('pnl-saved-')), after.join(', '))
  check('and keeps the precache', after.some((name) => name.startsWith('pnl-assets-')))
} finally {
  await browser.close()
  if (server) await stopServer(server)
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
