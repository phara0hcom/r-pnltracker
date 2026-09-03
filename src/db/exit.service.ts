/**
 * Storage for the exit-rule framework: the plans, the settings, and the daily
 * bars the TradingView webhook delivers.
 *
 * The split of responsibility with `lib/exit/` is the usual one for this repo —
 * everything here is I/O and mapping, and every judgement about what a stop or
 * a trail should be lives in the pure module, where it can be tested against
 * handmade bar sequences without a database.
 */
import Decimal from 'decimal.js'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { idFor } from './mappers'
import { exitFeedBars, exitRules, exitSettings, instruments } from './schema'
import { db } from './index'
import type { AccountType, AssetClass } from '~/lib/domain/types'
import { DEFAULT_EXIT_SETTINGS, type ExitSettings, type FeedBar, type TrailingMethod } from '~/lib/exit/types'

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

const exitRuleId = (userId: string, instrumentId: string, account: AccountType, entryDate: string) =>
  idFor('exitrule', userId, instrumentId, account, entryDate)

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
 * Creates a plan, taking the entry-date ATR from the feed if a bar for that day
 * has already arrived.
 *
 * Read once, here, and then stored — never re-read. That is the framework's
 * central rule: the initial stop is fixed at entry, so the ATR it was derived
 * from has to be frozen alongside it.
 */
export async function createExitRule(userId: string, input: ExitRuleInput): Promise<string> {
  const [instrument] = await db
    .select()
    .from(instruments)
    .where(eq(instruments.symbol, input.symbol))
  if (!instrument) throw new Error(`unknown instrument ${input.symbol}`)

  const [entryBar] = await db
    .select({ atr14: exitFeedBars.atr14 })
    .from(exitFeedBars)
    .where(
      and(
        eq(exitFeedBars.instrumentId, instrument.id),
        eq(exitFeedBars.tradingDay, input.entryDate),
      ),
    )

  const id = exitRuleId(userId, instrument.id, input.accountType, input.entryDate)

  await db
    .insert(exitRules)
    .values({
      id,
      userId,
      instrumentId: instrument.id,
      accountType: input.accountType,
      entryDate: input.entryDate,
      entryPrice: input.entryPrice,
      totalShares: input.totalShares,
      supportLevel: input.supportLevel,
      entryAtr: entryBar?.atr14 ?? null,
      lotSize: input.lotSize,
      trailingMethod: input.trailingMethod,
      note: input.note,
    })
    .onConflictDoUpdate({
      target: exitRules.id,
      set: {
        entryPrice: input.entryPrice,
        totalShares: input.totalShares,
        supportLevel: input.supportLevel,
        lotSize: input.lotSize,
        trailingMethod: input.trailingMethod,
        note: input.note,
        archivedAt: null,
        updatedAt: new Date(),
      },
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
    out.set(row.instrumentId, [...(out.get(row.instrumentId) ?? []), bar])
  }

  return out
}

export interface FeedBarInput {
  instrumentId: string
  tradingDay: string
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

/**
 * Stores one payload.
 *
 * Upsert on (instrument, day): TradingView can fire twice for the same close
 * after a chart reload, and a resent bar should correct the row rather than
 * duplicate it — a duplicated bar would distort the five-reading momentum
 * window that the time stop reads.
 */
export async function recordFeedBar(input: FeedBarInput): Promise<void> {
  await db
    .insert(exitFeedBars)
    .values(input)
    .onConflictDoUpdate({
      target: [exitFeedBars.instrumentId, exitFeedBars.tradingDay],
      // The key columns are the conflict target, so only the readings update.
      set: {
        barTime: input.barTime,
        exchange: input.exchange,
        close: input.close,
        sma10: input.sma10,
        sma20: input.sma20,
        rsi14: input.rsi14,
        macd: input.macd,
        macdSignal: input.macdSignal,
        macdHist: input.macdHist,
        atr14: input.atr14,
        receivedAt: new Date(),
      },
    })
}

/**
 * Fills in the entry ATR for any plan whose entry-date bar has just arrived.
 *
 * Not a recalculation — the framework forbids those. It completes a value that
 * was missing because the alert was created after the position was opened, and
 * only ever from the bar for the plan's own entry date, so the stop it yields is
 * the one that would have been set at entry had the feed existed then. Plans
 * that already carry an ATR are left alone.
 *
 * Driven from the webhook rather than a page load: this is the exact moment the
 * missing data appears, and it keeps the read path free of writes.
 */
export async function backfillEntryAtrForBar(
  instrumentId: string,
  tradingDay: string,
  atr14: string,
): Promise<number> {
  const filled = await db
    .update(exitRules)
    .set({ entryAtr: atr14, updatedAt: new Date() })
    .where(
      and(
        eq(exitRules.instrumentId, instrumentId),
        eq(exitRules.entryDate, tradingDay),
        isNull(exitRules.entryAtr),
      ),
    )
    .returning({ id: exitRules.id })

  return filled.length
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
