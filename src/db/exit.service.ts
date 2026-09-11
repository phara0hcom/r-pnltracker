/**
 * Storage for the exit-rule framework: the plans, the settings, and the daily
 * bars the TradingView webhook delivers.
 *
 * The split of responsibility with `lib/exit/` is the usual one for this repo —
 * everything here is I/O and mapping, and every judgement about what a stop or
 * a trail should be lives in the pure module, where it can be tested against
 * handmade bar sequences without a database.
 */
import { randomUUID } from 'node:crypto'
import Decimal from 'decimal.js'
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { idFor } from './mappers'
import { exitFeedBars, exitFeedDeliveries, exitRules, exitSettings, instruments } from './schema'
import { db } from './index'
import type { AccountType, AssetClass } from '~/lib/domain/types'
import { DEFAULT_EXIT_SETTINGS, type ExitSettings, type FeedBar, type TrailingMethod } from '~/lib/exit/types'
import type { TradingDayCandidates } from '~/lib/exit/webhook'

/** One stored plan, with the instrument it belongs to resolved. */
export interface ExitRuleRecord {
  id: string
  instrumentId: string
  symbol: string
  name: string
  assetClass: AssetClass
  accountType: AccountType
  entryDate: string
  entryPrice: Decimal
  totalShares: Decimal
  supportLevel: Decimal
  entryAtr: Decimal | null
  entryStopAtrMultiple: Decimal
  entryTargetMultiple: Decimal
  lotSize: number
  trailingMethod: TrailingMethod | null
  note: string | null
  archivedAt: Date | null
}

export interface ExitRuleInput {
  symbol: string
  accountType: AccountType
  entryDate: string
  entryPrice: string
  totalShares: string
  supportLevel: string
  lotSize: number
  trailingMethod: TrailingMethod | null
  note: string | null
}

/**
 * A fresh id per plan.
 *
 * Deliberately random rather than a hash of (user, instrument, account, entry
 * date): a deterministic id collides when the same pool is re-entered on the
 * same date after an earlier plan was archived, and an upsert on that id would
 * overwrite the archived record instead of creating a new plan. Uniqueness of
 * *live* plans is the partial index's job, not the primary key's.
 */
const newExitRuleId = () => idFor('exitrule', randomUUID())

function toRecord(row: {
  rule: typeof exitRules.$inferSelect
  instrument: typeof instruments.$inferSelect
}): ExitRuleRecord {
  return {
    id: row.rule.id,
    instrumentId: row.rule.instrumentId,
    symbol: row.instrument.symbol,
    name: row.instrument.name,
    assetClass: row.instrument.assetClass,
    accountType: row.rule.accountType,
    entryDate: row.rule.entryDate,
    entryPrice: new Decimal(row.rule.entryPrice),
    totalShares: new Decimal(row.rule.totalShares),
    supportLevel: new Decimal(row.rule.supportLevel),
    entryAtr: row.rule.entryAtr === null ? null : new Decimal(row.rule.entryAtr),
    entryStopAtrMultiple: new Decimal(row.rule.entryStopAtrMultiple),
    entryTargetMultiple: new Decimal(row.rule.entryTargetMultiple),
    lotSize: row.rule.lotSize,
    trailingMethod: row.rule.trailingMethod,
    note: row.rule.note,
    archivedAt: row.rule.archivedAt,
  }
}

/** Live plans, or every plan including retired ones when `includeArchived`. */
export async function listExitRules(
  userId: string,
  includeArchived = false,
): Promise<ExitRuleRecord[]> {
  const conditions = [eq(exitRules.userId, userId)]
  if (!includeArchived) conditions.push(isNull(exitRules.archivedAt))

  const rows = await db
    .select({ rule: exitRules, instrument: instruments })
    .from(exitRules)
    .innerJoin(instruments, eq(exitRules.instrumentId, instruments.id))
    .where(and(...conditions))
    .orderBy(asc(exitRules.entryDate))

  return rows.map(toRecord)
}

/**
 * One plan by id, archived or not, scoped to its owner.
 *
 * The `userId` condition is what makes this safe to call with an id straight
 * from a request body: a plan belonging to someone else simply does not exist.
 */
export async function getExitRule(userId: string, id: string): Promise<ExitRuleRecord | null> {
  const [row] = await db
    .select({ rule: exitRules, instrument: instruments })
    .from(exitRules)
    .innerJoin(instruments, eq(exitRules.instrumentId, instruments.id))
    .where(and(eq(exitRules.id, id), eq(exitRules.userId, userId)))
    .limit(1)

  return row ? toRecord(row) : null
}

/**
 * Creates a plan, taking the entry-date ATR from the feed if a bar for that day
 * has already arrived.
 *
 * Read once, here, and then stored — never re-read. That is the framework's
 * central rule: the initial stop is fixed at entry, so the ATR it was derived
 * from has to be frozen alongside it.
 */
export async function createExitRule(
  userId: string,
  input: ExitRuleInput,
  multiples: { stopAtr: string; target: string },
): Promise<string> {
  const [instrument] = await db
    .select()
    .from(instruments)
    .where(eq(instruments.symbol, input.symbol))
  if (!instrument) throw new Error(`unknown instrument ${input.symbol}`)

  // Checked explicitly rather than left to an upsert. The conflict target used
  // to be the primary key, which is not the constraint that governs uniqueness
  // here — the partial index on (user, instrument, account) WHERE archived_at IS
  // NULL is. The two disagreed in both directions: a second plan for the same
  // pool on a different entry date slipped past the upsert and died as a raw
  // 23505, while re-creating one for the same date silently resurrected and
  // overwrote the archived record.
  const [live] = await db
    .select({ id: exitRules.id })
    .from(exitRules)
    .where(
      and(
        eq(exitRules.userId, userId),
        eq(exitRules.instrumentId, instrument.id),
        eq(exitRules.accountType, input.accountType),
        isNull(exitRules.archivedAt),
      ),
    )
  if (live) {
    throw new Error(
      `${input.symbol} already has an active exit plan. Archive it before opening another.`,
    )
  }

  const [entryBar] = await db
    .select({ atr14: exitFeedBars.atr14 })
    .from(exitFeedBars)
    .where(
      and(
        eq(exitFeedBars.instrumentId, instrument.id),
        eq(exitFeedBars.tradingDay, input.entryDate),
      ),
    )

  const id = newExitRuleId()

  await db.insert(exitRules).values({
    id,
    userId,
    instrumentId: instrument.id,
    accountType: input.accountType,
    entryDate: input.entryDate,
    entryPrice: input.entryPrice,
    totalShares: input.totalShares,
    supportLevel: input.supportLevel,
    entryAtr: entryBar?.atr14 ?? null,
    // Frozen here, from the settings in force at creation.
    entryStopAtrMultiple: multiples.stopAtr,
    entryTargetMultiple: multiples.target,
    lotSize: input.lotSize,
    trailingMethod: input.trailingMethod,
    note: input.note,
  })

  return id
}

/**
 * Edits the locked entry facts.
 *
 * These are supposed to be immutable, and are — against the *feed*. This exists
 * for the different case of a typo: the support level was mistyped, or the
 * prefilled pool average was not the price this swing was actually entered at.
 * Correcting the record is not the same as letting the market move it.
 */
export async function updateExitRule(
  userId: string,
  id: string,
  patch: Partial<Pick<ExitRuleInput, 'entryPrice' | 'supportLevel' | 'totalShares' | 'trailingMethod' | 'note'>>,
): Promise<void> {
  await db
    .update(exitRules)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(exitRules.userId, userId), eq(exitRules.id, id)))
}

/** Retires a plan. Kept rather than deleted so the record of the trade survives. */
export async function archiveExitRule(userId: string, id: string): Promise<void> {
  await db
    .update(exitRules)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(exitRules.userId, userId), eq(exitRules.id, id)))
}

/**
 * Every stored bar for the given instruments, grouped and sorted ascending.
 *
 * The whole history is loaded rather than a trailing window: the highest close
 * since entry is unbounded in age, and the trailing ratchet is only correctable
 * because it can be replayed from the start.
 */
export async function barsFor(instrumentIds: string[]): Promise<Map<string, FeedBar[]>> {
  const out = new Map<string, FeedBar[]>()
  if (instrumentIds.length === 0) return out

  const rows = await db
    .select()
    .from(exitFeedBars)
    .where(inArray(exitFeedBars.instrumentId, instrumentIds))
    .orderBy(asc(exitFeedBars.tradingDay))

  for (const row of rows) {
    const bar: FeedBar = {
      tradingDay: row.tradingDay,
      close: new Decimal(row.close),
      sma10: new Decimal(row.sma10),
      sma20: new Decimal(row.sma20),
      rsi14: new Decimal(row.rsi14),
      macd: new Decimal(row.macd),
      macdSignal: new Decimal(row.macdSignal),
      macdHist: new Decimal(row.macdHist),
      atr14: new Decimal(row.atr14),
    }
    const bucket = out.get(row.instrumentId)
    if (bucket) bucket.push(bar)
    else out.set(row.instrumentId, [bar])
  }

  return out
}

export interface FeedBarDelivery {
  /** The tracker's own symbol, as `syminfo.ticker` emits it. */
  ticker: string
  /** Both candidate session dates — see `tradingDayCandidates`. */
  tradingDay: TradingDayCandidates
  barTime: Date
  exchange: string | null
  close: string
  sma10: string
  sma20: string
  rsi14: string
  macd: string
  macdSignal: string
  macdHist: string
  atr14: string
}

/** What the delivery resolved to, once the row it belongs to is known. */
export interface StoredFeedBar {
  instrumentId: string
  symbol: string
  assetClass: AssetClass
  /** The candidate the instrument's asset class selected. */
  tradingDay: string
  /** Plans whose entry-date ATR this bar completed. */
  backfilled: number
}

/**
 * Stores one payload: resolves the ticker, upserts the bar, and fills in any
 * entry ATR the bar completes — in a single statement.
 *
 * One statement rather than three because every alert of the day fires at the
 * same close, and each round trip is paid per delivery against a database on
 * another continent (see the region note in `vite.config.ts`). Three sequential
 * lookups meant a burst of open positions queued behind ~225ms of latency each,
 * and held a pooled connection for all of it.
 *
 * Upsert on (instrument, day): TradingView can fire twice for the same close
 * after a chart reload, and a resent bar should correct the row rather than
 * duplicate it — a duplicated bar would distort the five-reading momentum
 * window that the time stop reads.
 *
 * The backfill is not a recalculation — the framework forbids those. It
 * completes a value that was missing because the alert was created after the
 * position was opened, and only ever from the bar for the plan's own entry
 * date, so the stop it yields is the one that would have been set at entry had
 * the feed existed then. Plans that already carry an ATR are left alone. It
 * belongs on this path rather than a page load because this is the exact moment
 * the missing data appears, and it keeps the read path free of writes.
 *
 * Null when no instrument carries the ticker: an alert exists for something
 * this account has never traded, and there is nothing to attach a bar to.
 */
export async function storeFeedBar(input: FeedBarDelivery): Promise<StoredFeedBar | null> {
  /*
   * One stamp for the whole delivery, bound rather than left to `now()`. The
   * columns are `timestamp without time zone`, so `now()` — a timestamptz —
   * would be cast through whatever TimeZone the server session happens to
   * carry, while every other write in this codebase files UTC.
   */
  const at = new Date()

  /*
   * The instrument decides which candidate day is the bar's own, because
   * `zoneFor` falls back to the asset class and only the database holds it.
   * Choosing here rather than in a prior query is what removes that round trip;
   * the discriminator is `zoneFor`'s own, and `webhook.test.ts` pins the two
   * sides against each other.
   */
  const target = db.$with('target').as(
    db
      .select({
        id: instruments.id,
        symbol: instruments.symbol,
        assetClass: instruments.assetClass,
        tradingDay: sql<string>`case when ${instruments.assetClass} = 'US_EQUITY'
          then ${input.tradingDay.us}::date else ${input.tradingDay.jp}::date end`.as('trading_day'),
      })
      .from(instruments)
      .where(eq(instruments.symbol, input.ticker)),
  )

  const bar = db.$with('bar').as(
    db
      .insert(exitFeedBars)
      .select(
        // Column for column, in table order — `insert … select` requires it, and
        // it is checked at build time rather than by the server.
        db
          .select({
            instrumentId: target.id,
            tradingDay: target.tradingDay,
            barTime: sql`${sql.param(input.barTime, exitFeedBars.barTime)}`.as('bar_time'),
            exchange: sql`${sql.param(input.exchange, exitFeedBars.exchange)}`.as('exchange'),
            close: sql`${sql.param(input.close, exitFeedBars.close)}`.as('close'),
            sma10: sql`${sql.param(input.sma10, exitFeedBars.sma10)}`.as('sma10'),
            sma20: sql`${sql.param(input.sma20, exitFeedBars.sma20)}`.as('sma20'),
            rsi14: sql`${sql.param(input.rsi14, exitFeedBars.rsi14)}`.as('rsi14'),
            macd: sql`${sql.param(input.macd, exitFeedBars.macd)}`.as('macd'),
            macdSignal: sql`${sql.param(input.macdSignal, exitFeedBars.macdSignal)}`.as('macd_signal'),
            macdHist: sql`${sql.param(input.macdHist, exitFeedBars.macdHist)}`.as('macd_hist'),
            atr14: sql`${sql.param(input.atr14, exitFeedBars.atr14)}`.as('atr14'),
            receivedAt: sql`${sql.param(at, exitFeedBars.receivedAt)}`.as('received_at'),
          })
          .from(target),
      )
      .onConflictDoUpdate({
        target: [exitFeedBars.instrumentId, exitFeedBars.tradingDay],
        // The key columns are the conflict target, so only the readings update.
        set: {
          barTime: sql`excluded.bar_time`,
          exchange: sql`excluded.exchange`,
          close: sql`excluded.close`,
          sma10: sql`excluded.sma10`,
          sma20: sql`excluded.sma20`,
          rsi14: sql`excluded.rsi14`,
          macd: sql`excluded.macd`,
          macdSignal: sql`excluded.macd_signal`,
          macdHist: sql`excluded.macd_hist`,
          atr14: sql`excluded.atr14`,
          receivedAt: sql`excluded.received_at`,
        },
      })
      .returning({ instrumentId: exitFeedBars.instrumentId }),
  )

  const filled = db.$with('filled').as(
    db
      .update(exitRules)
      .set({ entryAtr: input.atr14, updatedAt: at })
      .from(target)
      .where(
        and(
          eq(exitRules.instrumentId, target.id),
          eq(exitRules.entryDate, target.tradingDay),
          isNull(exitRules.entryAtr),
        ),
      )
      .returning({ id: exitRules.id }),
  )

  /*
   * `bar` is written but never read back, which is deliberate and safe: a
   * data-modifying CTE runs exactly once and to completion whether or not the
   * outer query selects from it.
   */
  const [row] = await db
    .with(target, bar, filled)
    .select({
      instrumentId: target.id,
      symbol: target.symbol,
      assetClass: target.assetClass,
      tradingDay: target.tradingDay,
      // Cast because `count(*)` is a bigint, which `pg` hands back as a string.
      backfilled: sql<number>`(select count(*) from ${filled})::int`,
    })
    .from(target)

  return row ?? null
}

// ── Delivery log ────────────────────────────────────────────────────────────

/** How a delivery ended — see the enum on the table for what each means. */
export type FeedDeliveryOutcome = (typeof exitFeedDeliveries.$inferInsert)['outcome']

export interface FeedDeliveryRecord {
  receivedAt: Date
  durationMs: number
  outcome: FeedDeliveryOutcome
  status: number
  ticker: string | null
  exchange: string | null
  instrumentId: string | null
  tradingDay: string | null
  backfilled: number | null
  priced: boolean | null
  detail: string | null
}

/**
 * Files what happened to one delivery.
 *
 * A fresh random id rather than anything derived from the payload: two
 * deliveries of the same bar are two events, and collapsing them would erase
 * exactly the resend this log exists to make visible.
 *
 * This costs a round trip the webhook did not previously pay, and that is the
 * deliberate trade: without it the feed reports nothing but an HTTP status to a
 * machine, so a delivery that was processed and answered a moment too late is
 * indistinguishable from one that never arrived. The cost is measured in the
 * log itself — `durationMs` stops before this write, so the difference between
 * it and the gap to the next delivery is the price of keeping the record.
 */
export async function recordFeedDelivery(input: FeedDeliveryRecord): Promise<void> {
  await db.insert(exitFeedDeliveries).values({ id: idFor('delivery', randomUUID()), ...input })
}

/** A logged delivery with the instrument it resolved to, where it resolved. */
export type FeedDeliveryRow = typeof exitFeedDeliveries.$inferSelect & {
  symbol: string | null
  name: string | null
}

/** The most recent deliveries, newest first — what the Exit Rules screen shows. */
export async function recentFeedDeliveries(limit: number): Promise<FeedDeliveryRow[]> {
  const rows = await db
    .select({
      delivery: exitFeedDeliveries,
      symbol: instruments.symbol,
      name: instruments.name,
    })
    .from(exitFeedDeliveries)
    .leftJoin(instruments, eq(exitFeedDeliveries.instrumentId, instruments.id))
    .orderBy(desc(exitFeedDeliveries.receivedAt))
    .limit(limit)

  return rows.map(({ delivery, symbol, name }) => ({ ...delivery, symbol, name }))
}

/** Deliveries since a cutoff, for the counts the screen leads with. */
export async function feedDeliveryTally(since: Date): Promise<{
  total: number
  stored: number
  failed: number
  slowestMs: number | null
}> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      stored: sql<number>`count(*) filter (where ${exitFeedDeliveries.outcome} = 'STORED')::int`,
      failed: sql<number>`count(*) filter (where ${exitFeedDeliveries.outcome} <> 'STORED')::int`,
      slowestMs: sql<number | null>`max(${exitFeedDeliveries.durationMs})::int`,
    })
    .from(exitFeedDeliveries)
    .where(gte(exitFeedDeliveries.receivedAt, since))

  return row ?? { total: 0, stored: 0, failed: 0, slowestMs: null }
}

// ── Settings ────────────────────────────────────────────────────────────────

/** This user's tunables, falling back to the framework defaults. */
export async function getExitSettings(userId: string): Promise<ExitSettings> {
  const [row] = await db.select().from(exitSettings).where(eq(exitSettings.userId, userId))

  return {
    targetMultiple: new Decimal(row?.targetMultiple ?? DEFAULT_EXIT_SETTINGS.targetMultiple),
    partialExitFraction: new Decimal(
      row?.partialExitFraction ?? DEFAULT_EXIT_SETTINGS.partialExitFraction,
    ),
    initialStopAtrMultiple: new Decimal(
      row?.initialStopAtrMultiple ?? DEFAULT_EXIT_SETTINGS.initialStopAtrMultiple,
    ),
    trailingAtrMultiple: new Decimal(
      row?.trailingAtrMultiple ?? DEFAULT_EXIT_SETTINGS.trailingAtrMultiple,
    ),
    timeStopDays: row?.timeStopDays ?? DEFAULT_EXIT_SETTINGS.timeStopDays,
    trailingMethod: row?.trailingMethod ?? DEFAULT_EXIT_SETTINGS.trailingMethod,
    staleTradingDays: row?.staleTradingDays ?? DEFAULT_EXIT_SETTINGS.staleTradingDays,
  }
}

export interface ExitSettingsInput {
  targetMultiple: string
  partialExitFraction: string
  initialStopAtrMultiple: string
  trailingAtrMultiple: string
  timeStopDays: number
  trailingMethod: TrailingMethod
  staleTradingDays: number
}

export async function saveExitSettings(
  userId: string,
  input: ExitSettingsInput,
): Promise<void> {
  await db
    .insert(exitSettings)
    .values({ userId, ...input })
    .onConflictDoUpdate({
      target: exitSettings.userId,
      set: { ...input, updatedAt: new Date() },
    })
}
