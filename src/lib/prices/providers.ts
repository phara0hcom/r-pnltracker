/**
 * Price providers, tried in order until one answers.
 *
 * Finnhub's free tier covers US equities only — not the 20 JP tickers or 10
 * funds, which are roughly 78% of traded value here. So the chain degrades:
 * Finnhub → best-effort scrape → manual override → last known value.
 *
 * Nothing in this file may throw. A provider that fails returns null, the chain
 * moves on, and if every source fails the caller keeps the stored price and the
 * UI marks it stale. A pricing outage must never take down the app.
 */

export type PriceSource = 'FINNHUB' | 'SCRAPE' | 'MANUAL' | 'STALE'

export interface Quote {
  price: string
  currency: 'JPY' | 'USD'
  asOf: Date
  source: PriceSource
}

export interface QuoteRequest {
  symbol: string
  assetClass: 'JP_EQUITY' | 'US_EQUITY' | 'FUND'
}

const TIMEOUT_MS = 6000

/** Fetch with a hard timeout — a hanging provider must not stall a page render. */
async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return (await res.json()) as unknown
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** As `fetchJson`, for sources that only publish HTML. */
async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // A default fetch UA is refused by some JP sites outright.
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; pnltracker/1.0)' },
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Finnhub `/quote`. US equities only on the free tier.
 *
 * A rate-limited or exhausted key returns null rather than throwing, so the
 * caller falls through to the stored value.
 */
async function finnhub(req: QuoteRequest): Promise<Quote | null> {
  if (req.assetClass !== 'US_EQUITY') return null
  const key = process.env.FINNHUB_API_KEY
  if (!key) return null

  // Rakuten writes some tickers with a space (`BRK B`); Finnhub expects a dash.
  const symbol = req.symbol.replace(/\s+/g, '-')
  const data = await fetchJson(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`,
  )
  if (!data || typeof data !== 'object') return null

  const quote = data as { c?: number; t?: number }
  // Finnhub answers `c: 0` for an unknown symbol rather than erroring.
  if (typeof quote.c !== 'number' || quote.c <= 0) return null

  return {
    price: String(quote.c),
    currency: 'USD',
    asOf: quote.t ? new Date(quote.t * 1000) : new Date(),
    source: 'FINNHUB',
  }
}

/**
 * 東証 listing codes: four characters, historically all digits, but codes issued
 * since 2024 may end in a letter (`130A`). Matches the venue rule in
 * `lib/tradingview.ts` — both answer "is this a real listed ticker?".
 */
const TSE_CODE = /^\d{3}[\dA-Z]$/

/**
 * Whether an instrument has a ticker any provider could quote.
 *
 * Japanese mutual funds are identified in the exports by name only — there is no
 * code in any Rakuten CSV — and no free source publishes 基準価額 by fund name.
 * They are excluded here rather than attempted-and-failed, so a fund never
 * spends a request and never counts as a provider failure.
 */
export function hasQuotableTicker(symbol: string, assetClass: QuoteRequest['assetClass']): boolean {
  switch (assetClass) {
    case 'JP_EQUITY':
      return TSE_CODE.test(symbol)
    case 'US_EQUITY':
      return /^[A-Z]{1,5}([ .][A-Z])?$/.test(symbol)
    case 'FUND':
      return false
  }
}

/** Yahoo's unofficial chart endpoint. Fast, but rate-limits an IP that leans on it. */
async function yahooJp(symbol: string): Promise<Quote | null> {
  const data = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.T?interval=1d&range=1d`,
  )
  if (!data || typeof data !== 'object') return null

  const chart = (data as { chart?: { result?: { meta?: { regularMarketPrice?: number } }[] } })
    .chart
  const price = chart?.result?.[0]?.meta?.regularMarketPrice
  if (typeof price !== 'number' || price <= 0) return null

  return { price: String(price), currency: 'JPY', asOf: new Date(), source: 'SCRAPE' }
}

/**
 * kabutan.jp, read from the quote markup.
 *
 * HTML rather than JSON, so it breaks if they restyle the page — but it is the
 * only free source that answered when Yahoo started refusing, and it agreed with
 * Yahoo to the yen on every held symbol while both were up. Parsing is pinned to
 * the `kabuka` class the price sits in, and anything unexpected returns null.
 */
async function kabutanJp(symbol: string): Promise<Quote | null> {
  const html = await fetchText(`https://kabutan.jp/stock/?code=${symbol}`)
  if (!html) return null

  const match = /kabuka">([\d,]+(?:\.\d+)?)円/.exec(html)
  const raw = match?.[1]?.replace(/,/g, '')
  if (!raw) return null

  const price = Number(raw)
  if (!Number.isFinite(price) || price <= 0) return null

  return { price: String(price), currency: 'JPY', asOf: new Date(), source: 'SCRAPE' }
}

/**
 * Best-effort JP equity quote, first source that answers.
 *
 * Two sources rather than one because Yahoo rate-limits by IP and a deployed
 * instance shares an address with every other tenant — a single blocked provider
 * would otherwise leave every JP position unpriced at once.
 */
async function scrapeJp(req: QuoteRequest): Promise<Quote | null> {
  if (req.assetClass !== 'JP_EQUITY' || !TSE_CODE.test(req.symbol)) return null
  return (await yahooJp(req.symbol)) ?? (await kabutanJp(req.symbol))
}

/**
 * Provider chain.
 *
 * Returns null without a request for anything that has no quotable ticker, so a
 * fund is skipped rather than failed.
 */
export async function fetchQuote(req: QuoteRequest): Promise<Quote | null> {
  if (!hasQuotableTicker(req.symbol, req.assetClass)) return null
  return (await finnhub(req)) ?? (await scrapeJp(req))
}

export type ProviderState = 'OK' | 'NO_KEY' | 'BAD_KEY' | 'RATE_LIMITED' | 'UNREACHABLE'

export interface ProviderCheck {
  provider: string
  state: ProviderState
  /** One line, safe to render. Never contains the API key. */
  detail: string
}

/**
 * Live probe of Finnhub with a known-good ticker.
 *
 * `fetchQuote` deliberately swallows every failure so a pricing outage can't
 * break a page render — which also means a missing or rejected key looks
 * identical to "market closed". This distinguishes them, for the Settings
 * screen only.
 */
export async function checkFinnhub(): Promise<ProviderCheck> {
  const key = process.env.FINNHUB_API_KEY?.trim()
  if (!key) {
    return {
      provider: 'Finnhub',
      state: 'NO_KEY',
      detail: 'FINNHUB_API_KEY is not set, so US quotes are never fetched.',
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, TIMEOUT_MS)

  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${key}`, {
      signal: controller.signal,
    })

    if (res.status === 401 || res.status === 403) {
      return { provider: 'Finnhub', state: 'BAD_KEY', detail: `Key rejected (HTTP ${String(res.status)}).` }
    }
    if (res.status === 429) {
      return {
        provider: 'Finnhub',
        state: 'RATE_LIMITED',
        detail: 'Quota exhausted (HTTP 429). Stored prices are still served.',
      }
    }
    if (!res.ok) {
      return { provider: 'Finnhub', state: 'UNREACHABLE', detail: `HTTP ${String(res.status)}.` }
    }

    const body = (await res.json()) as { c?: number }
    if (typeof body.c !== 'number' || body.c <= 0) {
      return {
        provider: 'Finnhub',
        state: 'BAD_KEY',
        detail: 'Responded, but returned no price for AAPL.',
      }
    }

    return { provider: 'Finnhub', state: 'OK', detail: `Working — AAPL quoted at $${String(body.c)}.` }
  } catch {
    return { provider: 'Finnhub', state: 'UNREACHABLE', detail: 'No response within 6s.' }
  } finally {
    clearTimeout(timer)
  }
}

/** Same probe for the keyless FX source, which is the other live dependency. */
export async function checkFx(): Promise<ProviderCheck> {
  const fx = await fetchUsdJpy()
  return fx
    ? { provider: 'USD/JPY', state: 'OK', detail: `Working — 1 USD = ¥${fx.rate}.` }
    : { provider: 'USD/JPY', state: 'UNREACHABLE', detail: 'open.er-api.com did not respond.' }
}

/** And for the JP scrape, which is expected to fail more often than not. */
export async function checkJpScrape(): Promise<ProviderCheck> {
  // 7203 (Toyota) is the most liquid JP listing — if anything resolves, it does.
  const q = await scrapeJp({ symbol: '7203', assetClass: 'JP_EQUITY' })
  return q
    ? { provider: 'JP equities', state: 'OK', detail: `Working — 7203 quoted at ¥${q.price}.` }
    : {
        provider: 'JP equities',
        state: 'UNREACHABLE',
        detail: 'Blocked or rate-limited, as expected. Use a manual price.',
      }
}

export interface FxQuote {
  rate: string
  asOf: Date
}

/**
 * USD/JPY. Free, keyless, and verified working — unlike the equity sources.
 * Returns null on failure so the stored rate is kept.
 */
export async function fetchUsdJpy(): Promise<FxQuote | null> {
  const data = await fetchJson('https://open.er-api.com/v6/latest/USD')
  if (!data || typeof data !== 'object') return null

  const body = data as { rates?: Record<string, number>; time_last_update_unix?: number }
  const rate = body.rates?.JPY
  if (typeof rate !== 'number' || rate <= 0) return null

  return {
    rate: String(rate),
    asOf: body.time_last_update_unix ? new Date(body.time_last_update_unix * 1000) : new Date(),
  }
}
