/**
 * Price refresh and manual overrides.
 *
 * Refresh is lazy — triggered by visiting a screen, never by a cron — because
 * the Finnhub free tier is quota-limited. Only open positions are fetched, and
 * only when the stored quote is older than the TTL.
 */
import { createServerFn } from '@tanstack/react-start'
import Decimal from 'decimal.js'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { authed } from './middleware'
import { db } from '~/db'
import { instrumentId } from '~/db/mappers'
import { fxRates as schemaFx, instruments, priceCache, priceOverrides } from '~/db/schema'
import { listTrades } from '~/db/trades.service'
import type { AssetClass } from '~/lib/domain/types'
import { runEngine } from '~/lib/pnl/engine'
import {
  checkFinnhub,
  checkFx,
  checkJpScrape,
  fetchQuote,
  fetchUsdJpy,
  hasQuotableTicker,
  type ProviderCheck,
} from '~/lib/prices/providers'

/** Intraday TTL. A quote younger than this is not re-fetched. */
const TTL_MS = 15 * 60_000

export interface RefreshResult {
  /** Positions a provider was actually asked about — excludes `noSource`. */
  attempted: number
  updated: number
  /** A provider was asked and could not answer. Worth surfacing; may be transient. */
  failed: number
  /**
   * Positions with no quotable ticker, so no provider was contacted at all.
   *
   * Kept apart from `failed` because it is not an error: funds are named, not
   * coded, in every Rakuten export and no free source publishes 基準価額 by name.
   * Counting them as failures made a working refresh look broken.
   */
  noSource: number
  fxUpdated: boolean
  /** Symbols with no usable price — these need a manual entry in Settings. */
  needsManual: string[]
}

export const refreshPrices = createServerFn({ method: 'POST' })
  .middleware([authed])
  .handler(async ({ context }): Promise<RefreshResult> => {
    const records = await listTrades(context.userId)
    const { positions } = runEngine(records.map((record) => record.trade))

    const [cached, overridden] = await Promise.all([
      db.select().from(priceCache),
      db
        .select({ instrumentId: priceOverrides.instrumentId })
        .from(priceOverrides)
        .where(eq(priceOverrides.userId, context.userId)),
    ])
    const byId = new Map(cached.map((row) => [row.instrumentId, row]))
    const overriddenIds = new Set(overridden.map((row) => row.instrumentId))
    const now = Date.now()

    let updated = 0
    let failed = 0
    let attempted = 0
    let noSource = 0
    const needsManual: string[] = []

    for (const position of positions) {
      const id = instrumentId(position.symbol)
      const existing = byId.get(id)

      // A manual override is authoritative; never spend quota refreshing a
      // price this user has already decided for themselves.
      if (overriddenIds.has(id)) continue

      // Nothing to ask: no provider quotes an instrument that has no ticker.
      // Checked before the TTL so the count is stable regardless of cache age.
      if (!hasQuotableTicker(position.symbol, position.assetClass)) {
        noSource++
        if (!existing) needsManual.push(position.symbol)
        continue
      }

      // Still fresh — skip to protect the quota.
      if (existing && now - existing.fetchedAt.getTime() < TTL_MS) continue

      attempted++
      const quote = await fetchQuote({ symbol: position.symbol, assetClass: position.assetClass })
      if (!quote) {
        failed++
        if (!existing) needsManual.push(position.symbol)
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
      attempted,
      updated,
      failed,
      noSource,
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
    const { positions } = runEngine(records.map((record) => record.trade))
    const ids = positions.map((position) => instrumentId(position.symbol))
    if (ids.length === 0) return []

    const [cached, overrides] = await Promise.all([
      db.select().from(priceCache).where(inArray(priceCache.instrumentId, ids)),
      db
        .select()
        .from(priceOverrides)
        .where(
          and(eq(priceOverrides.userId, context.userId), inArray(priceOverrides.instrumentId, ids)),
        ),
    ])
    const byId = new Map(cached.map((row) => [row.instrumentId, row]))
    const overrideById = new Map(overrides.map((row) => [row.instrumentId, row]))

    return positions
      .map((position) => {
        const id = instrumentId(position.symbol)
        const cached = byId.get(id)
        const override = overrideById.get(id)
        return {
          symbol: position.symbol,
          name: position.name,
          assetClass: position.assetClass,
          // An override wins, exactly as it does in `getPositions` — reading the
          // cache alone showed "—" for every hand-priced fund, because a fund
          // has no cache row at all. That is the one case the override exists
          // for, so the screen denied having saved the value the user just typed.
          price: override?.price ?? cached?.price ?? null,
          currency: override?.currency ?? cached?.currency ?? null,
          source: override ? 'MANUAL' : (cached?.source ?? null),
          asOf: (override?.setAt ?? cached?.asOf)?.toISOString() ?? null,
          manualOverride: override?.price ?? null,
          // Only instruments no provider can quote at all — funds. JP equities
          // scrape reliably, so flagging them here sent the user to type prices
          // the app was already fetching.
          needsManual: !hasQuotableTicker(position.symbol, position.assetClass),
        }
      })
      .sort((left, right) => left.symbol.localeCompare(right.symbol))
  })

/**
 * A price typed into Settings.
 *
 * Validated rather than passed straight through: this string lands in a
 * `numeric` column, so anything non-numeric would surface as a database error
 * and a 500 rather than a message the user can act on.
 */
const manualPriceSchema = z.object({
  symbol: z.string().trim().min(1).max(128),
  /** Null clears the override and hands the instrument back to the providers. */
  price: z
    .string()
    .trim()
    .refine((raw) => {
      try {
        const parsed = new Decimal(raw)
        return parsed.isFinite() && parsed.gt(0)
      } catch {
        return false
      }
    }, 'must be a positive number')
    .nullable(),
})

export const setManualPrice = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => manualPriceSchema.parse(data))
  .handler(async ({ data, context }) => {
    const id = instrumentId(data.symbol)
    const [inst] = await db.select().from(instruments).where(eq(instruments.id, id))
    if (!inst) throw new Error(`unknown instrument ${data.symbol}`)

    if (data.price === null) {
      // Clearing removes the row entirely, so the provider chain takes over
      // again and whatever the shared cache last held is served.
      await db
        .delete(priceOverrides)
        .where(and(eq(priceOverrides.userId, context.userId), eq(priceOverrides.instrumentId, id)))
      return { ok: true as const }
    }

    const currency = inst.assetClass === 'US_EQUITY' ? ('USD' as const) : ('JPY' as const)

    await db
      .insert(priceOverrides)
      .values({ userId: context.userId, instrumentId: id, price: data.price, currency })
      .onConflictDoUpdate({
        target: [priceOverrides.userId, priceOverrides.instrumentId],
        set: { price: data.price, currency, setAt: new Date() },
      })

    return { ok: true as const }
  })
