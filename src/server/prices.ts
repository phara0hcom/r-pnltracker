/**
 * Price refresh and manual overrides.
 *
 * Refresh is lazy — triggered by visiting a screen, never by a cron — because
 * the Finnhub free tier is quota-limited. Only open positions are fetched, and
 * only when the stored quote is older than the TTL.
 */
import { createServerFn } from '@tanstack/react-start'
import { eq, inArray } from 'drizzle-orm'
import { authed } from './middleware'
import { db } from '~/db'
import { instrumentId } from '~/db/mappers'
import { fxRates as schemaFx, instruments, priceCache } from '~/db/schema'
import { listTrades } from '~/db/trades.service'
import type { AssetClass } from '~/lib/domain/types'
import { runEngine } from '~/lib/pnl/engine'
import {
  checkFinnhub,
  checkFx,
  checkJpScrape,
  fetchQuote,
  fetchUsdJpy,
  type ProviderCheck,
} from '~/lib/prices/providers'

/** Intraday TTL. A quote younger than this is not re-fetched. */
const TTL_MS = 15 * 60_000

export interface RefreshResult {
  attempted: number
  updated: number
  failed: number
  fxUpdated: boolean
  /** Symbols with no usable source — these need a manual price. */
  needsManual: string[]
}

export const refreshPrices = createServerFn({ method: 'POST' })
  .middleware([authed])
  .handler(async ({ context }): Promise<RefreshResult> => {
    const records = await listTrades(context.userId)
    const { positions } = runEngine(records.map((r) => r.trade))

    const cached = await db.select().from(priceCache)
    const byId = new Map(cached.map((c) => [c.instrumentId, c]))
    const now = Date.now()

    let updated = 0
    let failed = 0
    const needsManual: string[] = []

    for (const p of positions) {
      const id = instrumentId(p.symbol)
      const existing = byId.get(id)

      // A manual override is authoritative; never overwrite it with a fetch.
      if (existing?.manualOverride) continue
      // Still fresh — skip to protect the quota.
      if (existing && now - existing.fetchedAt.getTime() < TTL_MS) continue

      const quote = await fetchQuote({ symbol: p.symbol, assetClass: p.assetClass })
      if (!quote) {
        failed++
        if (!existing) needsManual.push(p.symbol)
        continue
      }

      await db
        .insert(priceCache)
        .values({
          instrumentId: id,
          price: quote.price,
          currency: quote.currency,
          asOf: quote.asOf,
          source: quote.source,
        })
        .onConflictDoUpdate({
          target: priceCache.instrumentId,
          set: {
            price: quote.price,
            currency: quote.currency,
            asOf: quote.asOf,
            source: quote.source,
            fetchedAt: new Date(),
          },
        })
      updated++
    }

    const fx = await fetchUsdJpy()
    if (fx) {
      await db
        .insert(schemaFx)
        .values({ base: 'USD', quote: 'JPY', rate: fx.rate, asOf: fx.asOf })
        .onConflictDoUpdate({
          target: [schemaFx.base, schemaFx.quote],
          set: { rate: fx.rate, asOf: fx.asOf, fetchedAt: new Date() },
        })
    }

    return {
      attempted: positions.length,
      updated,
      failed,
      fxUpdated: fx != null,
      needsManual,
    }
  })

/**
 * Live status of each price source.
 *
 * POST because it makes outbound calls — this must never run as part of a page
 * loader, only when the button is pressed.
 */
export const checkProviders = createServerFn({ method: 'POST' })
  .middleware([authed])
  .handler(async (): Promise<ProviderCheck[]> => {
    // Run together: three sequential 6s timeouts would be a 18s wait on the
    // worst path, and they are independent.
    return Promise.all([checkFinnhub(), checkFx(), checkJpScrape()])
  })

/** Every held instrument with its current price state, for the Settings screen. */
export interface PriceEntry {
  symbol: string
  name: string
  assetClass: AssetClass
  price: string | null
  currency: string | null
  source: string | null
  asOf: string | null
  manualOverride: string | null
  /** True when no provider can price this — funds and most JP tickers. */
  needsManual: boolean
}

export const listPrices = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(async ({ context }): Promise<PriceEntry[]> => {
    const records = await listTrades(context.userId)
    const { positions } = runEngine(records.map((r) => r.trade))
    const ids = positions.map((p) => instrumentId(p.symbol))
    if (ids.length === 0) return []

    const cached = await db.select().from(priceCache).where(inArray(priceCache.instrumentId, ids))
    const byId = new Map(cached.map((c) => [c.instrumentId, c]))

    return positions
      .map((p) => {
        const c = byId.get(instrumentId(p.symbol))
        return {
          symbol: p.symbol,
          name: p.name,
          assetClass: p.assetClass,
          price: c?.price ?? null,
          currency: c?.currency ?? null,
          source: c?.manualOverride ? 'MANUAL' : (c?.source ?? null),
          asOf: c?.asOf.toISOString() ?? null,
          manualOverride: c?.manualOverride ?? null,
          // Funds have no free source; JP equities only a fragile one.
          needsManual: p.assetClass !== 'US_EQUITY',
        }
      })
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
  })

export const setManualPrice = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: { symbol: string; price: string | null }) => data)
  .handler(async ({ data }) => {
    const id = instrumentId(data.symbol)
    const [inst] = await db.select().from(instruments).where(eq(instruments.id, id))
    if (!inst) throw new Error(`unknown instrument ${data.symbol}`)

    const currency = inst.assetClass === 'US_EQUITY' ? ('USD' as const) : ('JPY' as const)

    await db
      .insert(priceCache)
      .values({
        instrumentId: id,
        price: data.price ?? '0',
        currency,
        asOf: new Date(),
        source: 'MANUAL',
        manualOverride: data.price,
        manualOverrideAt: data.price ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: priceCache.instrumentId,
        set: {
          manualOverride: data.price,
          manualOverrideAt: data.price ? new Date() : null,
          // Clearing an override falls back to whatever a provider last returned.
          ...(data.price ? { price: data.price, asOf: new Date(), source: 'MANUAL' as const } : {}),
        },
      })

    return { ok: true as const }
  })
