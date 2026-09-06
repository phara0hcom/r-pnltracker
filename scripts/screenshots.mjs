/**
 * Regenerates the README screenshots.
 *
 * Run: `node scripts/screenshots.mjs`
 *
 * The captures come from the design-handoff mocks in
 * `design_handoff_content_redesign 2/`, not from a running app, and that is
 * deliberate: the repository is public and the live database holds the owner's
 * real Rakuten portfolio. The mocks carry invented but internally consistent
 * figures (frames sum to their totals, tax derivations compute, bar widths match
 * their values), so the screenshots show the shipped layout without publishing
 * anyone's holdings. Every mock here was implemented — see commit 3c64533 for
 * the seven analysis screens and f9004a6 for Exit Rules.
 *
 * Each mock renders a 1440px desktop frame and a 390px phone frame side by side,
 * wrapped in design-review annotations. Only the frames are captured.
 */
import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = `${ROOT}design_handoff_content_redesign 2`
const OUT = `${ROOT}docs/screenshots`

/** Mock file → output basename. Order matches the sidebar. */
const SCREENS = [
  ['Dashboard - Redesign.dc.html', 'dashboard'],
  ['Calendar - Redesign.dc.html', 'calendar'],
  ['Positions - Redesign.dc.html', 'positions'],
  ['Stats - Redesign.dc.html', 'stats'],
  ['NISA - Redesign.dc.html', 'nisa'],
  ['Tax - Redesign.dc.html', 'tax'],
  ['Dividends - Redesign.dc.html', 'dividends'],
  ['Exits - Redesign.dc.html', 'exits'],
]

/**
 * The desktop app frame — the only element laid out as sidebar + content.
 *
 * Matched on the normalised style attribute: the canvas runtime reserialises
 * every inline style on load, so the source's `grid-template-columns:var(…)`
 * is `grid-template-columns: var(…)` by the time this runs.
 */
const PC_FRAME = 'div[style*="var(--sidebar-width) 1fr"]'
/** The phone frame, at 390px. */
const SP_FRAME = 'div[style*="width: 390px"]'

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }

/**
 * The mocks must be served over HTTP, not opened as files.
 *
 * Each one pulls its shared components (Rail, TopBar, Switch, FilterTrigger)
 * and its table data with `fetch`, which refuses the `file:` scheme — under
 * `file://` the sidebar renders empty and every table row comes out as an
 * unresolved `{{ r.symbol }}` placeholder.
 */
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const full = `${SRC}${path}`
  stat(full)
    .then(() => {
      const ext = path.slice(path.lastIndexOf('.'))
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' })
      createReadStream(full).pipe(res)
    })
    .catch(() => {
      res.writeHead(404).end('not found')
    })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1800, height: 1200 },
  deviceScaleFactor: 2,
})

const problems = []
page.on('console', (m) => {
  const t = m.text()
  // A failed sibling fetch is fatal to a capture — it renders the sidebar empty.
  // `never resolved` is usually benign: the runtime reports it once for the
  // hidden row template each repeating table keeps, and the visible rows are
  // fine. Worth surfacing anyway, since the same warning is what a genuinely
  // unbound column would produce. Check the image when the count looks wrong.
  if (t.includes('never resolved') || t.includes('sibling fetch')) problems.push(t.slice(0, 120))
})

for (const [file, name] of SCREENS) {
  problems.length = 0
  await page.goto(`${origin}/${encodeURIComponent(file)}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(600)

  // Dashboard draws two competing directions; 1a "Ledger" is the one that shipped.
  const pc = page.locator(PC_FRAME).first()
  const box = await pc.boundingBox()
  await pc.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`${name}.png`.padEnd(18), box ? `${Math.round(box.width)}x${Math.round(box.height)}` : '??')

  const sp = page.locator(SP_FRAME).first()
  if (await sp.count()) {
    await sp.screenshot({ path: `${OUT}/${name}-sp.png` })
  }

  if (problems.length) {
    console.log(`  ⚠ ${String(problems.length)} unresolved: ${problems[0]}`)
  }
}

await browser.close()
server.close()

// WebP at q82 takes the sixteen captures from ~5.1MB to ~1.7MB with no visible
// loss on flat dark UI, and GitHub renders it in Markdown. Needs `cwebp`
// (`brew install webp`); without it the PNGs are left in place and the README's
// `.webp` references have to be repointed by hand.
try {
  execFileSync('cwebp', ['-version'], { stdio: 'ignore' })
} catch {
  console.log('\ncwebp not found — leaving PNGs. `brew install webp` to shrink them.')
  process.exit(0)
}

for (const [, name] of SCREENS) {
  for (const variant of [name, `${name}-sp`]) {
    const png = `${OUT}/${variant}.png`
    try {
      await stat(png)
    } catch {
      continue
    }
    execFileSync('cwebp', ['-quiet', '-q', '82', '-m', '6', png, '-o', `${OUT}/${variant}.webp`])
    await rm(png)
  }
}
console.log('\nconverted to webp')
