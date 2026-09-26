/**
 * Import planning — decides what a file would actually add before anything is
 * written, so an import can be previewed and re-running one is harmless.
 *
 * Identity is `sourceRowHash`: the trade's identifying fields plus a per-file
 * occurrence ordinal. The ordinal exists because a single order is often filled
 * as several byte-identical executions (3× KO @ $85.58 on 2026-07-21); without
 * it those collapse into one and real trades vanish.
 *
 * The ordinal is safe across partial re-exports because the hashed key includes
 * the trade date — any date-filtered export contains either all executions of a
 * given key or none, so the ordinals it assigns match those of the full export.
 *
 * ## Restatements
 *
 * The trade date is in that hash, and for US trades Rakuten changes it. An
 * export taken before settlement dates the fill by its *US* trading day; once
 * it settles, later exports date the same fill by the JST day it executed on,
 * one day later, and carry the settlement FX rate rather than the provisional
 * one. Three fills were affected in production (CAG, BABA, SEDG, all 2026-09):
 * the hash no longer matched, so the sell was inserted a second time and the
 * engine warned `close with no open position` on the copy. Had the pool been
 * larger than the fill, both copies would have booked and realized P&L would
 * have been double-counted instead.
 *
 * So `planImport` makes a second pass. A row whose hash is unknown, but which
 * matches a stored row on everything the broker does *not* restate — symbol,
 * account, side, quantity, price and 受渡日 — and differs only by a day in the
 * trade date, is the same execution. Settlement is T+n business days from the
 * trade date, so two genuinely distinct fills of one instrument cannot share a
 * 受渡日; equal 受渡日 with a different 約定日 is a restatement by construction.
 * The later date wins, being the one Rakuten settles on and reports on the
 * 年間取引報告書; an older export arriving afterwards is skipped rather than
 * allowed to revert the row.
 *
 * ## Settlement
 *
 * A row exported before it settles is provisional even when its hash never
 * changes. A JP row has `受渡金額 = "-"` and no commission yet; a US row carries
 * the rate of the moment rather than the day's settled one (SMCI and SOFI on
 * 2026-09-02: 159.86 and 159.99 against the 160.14 every later export shows).
 * Matching the hash used to mean "already imported", so the final figures
 * never landed: 34 JP rows sat at ¥0 commission for up to two months. A matched row is
 * now updated in place when the file is final for it — the row is settled in
 * the file and not yet in storage, or the file was exported after the row's
 * 受渡日 and states different figures.
 *
 * Settlement can also regroup fills. An intraday export listed 8729's one
 * sell order of 2026-09-15 as 1,000 + 800 + 2,600 shares; after settlement
 * Rakuten lists the same 4,400 as 1,800 + 2,600. The 1,800 has a new hash, so
 * it was inserted beside the 1,000 and 800 it replaces, and the day sold 6,200
 * shares of a 4,400 position. An export lists every fill of any date it
 * covers, so where it states a day's fills as settled, stored rows for that
 * day that are still unsettled and that it no longer lists are superseded —
 * soft-deleted, so the intraday export cannot bring them back. The reverse
 * holds too: an intraday export arriving after the settled one adds nothing
 * to a day already stored as settled.
 */
import type {
  AccountType,
  NormalizedDividend,
  NormalizedTrade,
  ParseResult,
  TradeSide,
} from '../domain/types'
import { decodeShiftJis } from './decode'
import { detectFormat } from './tradeHistory'

/**
 * Order a batch so trade histories commit before statements.
 *
 * Two things are resolved from the trade history and cannot be resolved without
 * it: an instrument's asset class, and which account held the units a dividend
 * was paid on. A 取引残高報告書 committed first therefore falls back to what its
 * own section headers say, which is weaker — and for the asset class that answer
 * used to stick permanently, because nothing later overwrote it.
 *
 * The upload screen stages files in whatever order the OS hands over the
 * `FileList` — drag order, or alphabetical, neither of which is meaningful — so
 * the ordering is enforced rather than left to how the user dropped them. The
 * sort is stable, so files of the same kind keep their original order.
 */
export function orderFilesForImport<T extends { bytes: Uint8Array }>(files: T[]): T[] {
  const isStatement = (f: T) => detectFormat(decodeShiftJis(f.bytes)) === 'TORIZAN'
  return files
    // Original index carried alongside so the sort is stable: files of equal
    // rank keep the order the user chose them in.
    .map((file, chosenOrder) => ({ file, chosenOrder, rank: isStatement(file) ? 1 : 0 }))
    .sort((left, right) =>
      left.rank !== right.rank ? left.rank - right.rank : left.chosenOrder - right.chosenOrder,
    )
    .map(({ file }) => file)
}

/**
 * A stored trade, as the planner needs to see it.
 *
 * Deliberately not the database row type: `src/lib/` stays DB-free, and the
 * planner needs only identity — enough to recognise the same execution
 * arriving back under a different 約定日.
 */
export interface StoredTrade {
  id: string
  sourceRowHash: string
  symbol: string
  accountType: AccountType
  side: TradeSide
  /** Canonical `Decimal` notation, so `250` and `250.00000000` compare equal. */
  quantity: string
  unitPrice: string
  tradeDate: string
  settleDate: string
  /** A hand-correction outranks the export; an import must not revert it. */
  isEdited: boolean
  /** Manual rows are never matched, overwritten, or removed by an import. */
  origin: 'IMPORT' | 'MANUAL'
  /** False while the row still holds pre-settlement figures. */
  isSettled: boolean
  /** A tombstone: it still claims its hash, but nothing updates or supersedes it. */
  isDeleted: boolean
  /** The figures settlement can change — see `figuresOf`. */
  figures: string
}

/** The money on a row that settlement can restate, in one comparable string. */
export function figuresOf(row: {
  fee: { toFixed(): string }
  feeTax: { toFixed(): string }
  otherCost: { toFixed(): string }
  fxRate: { toFixed(): string }
  grossAmount: { toFixed(): string }
  netAmount: { toFixed(): string }
  netAmountJpy: { toFixed(): string }
}): string {
  return [
    row.fee,
    row.feeTax,
    row.otherCost,
    row.fxRate,
    row.grossAmount,
    row.netAmount,
    row.netAmountJpy,
  ]
    .map((value) => value.toFixed())
    .join('|')
}

/** A stored row the broker restated — updated in place rather than inserted. */
export interface RestatedTrade {
  /** The stored row's id. Updating in place keeps its memo and journal. */
  id: string
  previousTradeDate: string
  trade: NormalizedTrade
}

/** A stored row the file carries final figures for — updated in place. */
export interface SettledTrade {
  id: string
  trade: NormalizedTrade
}

export interface ImportPlan {
  /** Rows not already stored — these would be inserted. */
  newTrades: NormalizedTrade[]
  newDividends: NormalizedDividend[]
  /** Stored rows the file re-dates — these would be updated, not inserted. */
  restatedTrades: RestatedTrade[]
  /** Stored rows the file settles or re-rates — updated with its figures. */
  settledTrades: SettledTrade[]
  /** Stored intraday fills the settled export regroups — soft-deleted. */
  supersededTrades: StoredTrade[]
  /** Rows already stored, skipped. */
  duplicateTrades: number
  duplicateDividends: number
  /** Rows that failed to parse. Never blocks the rest of the import. */
  errors: ParseResult['errors']
}

/**
 * Everything about a fill that a restatement leaves alone.
 *
 * 受渡日 is in the key rather than 約定日 precisely because it is the half that
 * survives: the settlement date is fixed at execution and never moves, while
 * the trade date is rewritten from the US day to the JST one.
 */
function executionKey(row: {
  symbol: string
  accountType: AccountType
  side: TradeSide
  quantity: string
  unitPrice: string
  settleDate: string
}): string {
  return [row.symbol, row.accountType, row.side, row.quantity, row.unitPrice, row.settleDate].join(
    '\0',
  )
}

const epochDays = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)

/** One day's fills of one instrument on one side — what an export lists whole. */
const dayKey = (row: { tradeDate: string; symbol: string; accountType: AccountType; side: TradeSide }) =>
  [row.tradeDate, row.symbol, row.accountType, row.side].join('\0')

/** Stored rows an import may rewrite: imported, not hand-corrected, not deleted. */
const rewritable = (row: StoredTrade) => row.origin === 'IMPORT' && !row.isEdited && !row.isDeleted

/**
 * Compare a parse result against what is already stored.
 *
 * `stored` / `existingDividendHashes` come from the DB, so this mirrors exactly
 * what the database would accept — the preview cannot disagree with the commit.
 */
export function planImport(
  parsed: ParseResult,
  stored: readonly StoredTrade[],
  existingDividendHashes: ReadonlySet<string> = new Set(),
): ImportPlan {
  const storedByHash = new Map(stored.map((row) => [row.sourceRowHash, row]))
  const seenTrades = new Set(storedByHash.keys())
  const newTrades: NormalizedTrade[] = []
  const restatedTrades: RestatedTrade[] = []
  const settledTrades: SettledTrade[] = []
  let duplicateTrades = 0

  // The export was taken no earlier than its latest trade, so a row settling
  // before that date is stated at its final figures.
  const exportedAfter = parsed.trades.reduce(
    (latest, trade) => (trade.tradeDate > latest ? trade.tradeDate : latest),
    '',
  )
  const isFinalFor = (trade: NormalizedTrade, row: StoredTrade) =>
    trade.isSettled &&
    (!row.isSettled || (exportedAfter > trade.settleDate && figuresOf(trade) !== row.figures))

  // Pass one, on the hash alone. A stored row matched here is spoken for, so
  // pass two cannot also claim it as the restatement of some other row.
  const unmatched: NormalizedTrade[] = []
  const claimed = new Set<string>()

  for (const trade of parsed.trades) {
    // Guards both against re-importing a stored row and against the same row
    // appearing twice within one upload batch.
    if (seenTrades.has(trade.sourceRowHash)) {
      const row = storedByHash.get(trade.sourceRowHash)
      if (row) claimed.add(row.id)
      if (row && rewritable(row) && isFinalFor(trade, row)) settledTrades.push({ id: row.id, trade })
      else duplicateTrades++
      continue
    }
    seenTrades.add(trade.sourceRowHash)
    unmatched.push(trade)
  }

  // Pass two, on the fill itself. Candidates are consumed as they are paired
  // off, so an order filled as several identical executions still matches
  // one-for-one instead of collapsing onto whichever stored row comes first.
  const candidates = new Map<string, StoredTrade[]>()
  for (const row of stored) {
    if (claimed.has(row.id) || row.origin === 'MANUAL') continue
    const key = executionKey(row)
    const bucket = candidates.get(key)
    if (bucket) bucket.push(row)
    else candidates.set(key, [row])
  }

  for (const trade of unmatched) {
    const bucket = candidates.get(
      executionKey({
        symbol: trade.symbol,
        accountType: trade.accountType,
        side: trade.side,
        quantity: trade.quantity.toFixed(),
        unitPrice: trade.unitPrice.toFixed(),
        settleDate: trade.settleDate,
      }),
    )
    // Exactly one day, never zero: same trade date with a different hash is a
    // further execution of a split order, which must be inserted, not merged.
    const index =
      bucket?.findIndex((row) => Math.abs(epochDays(trade.tradeDate) - epochDays(row.tradeDate)) === 1) ??
      -1
    if (index < 0) {
      newTrades.push(trade)
      continue
    }

    const [row] = bucket!.splice(index, 1)
    claimed.add(row!.id)
    if (row!.isEdited || trade.tradeDate < row!.tradeDate) {
      // An older export, or a row the user has corrected by hand. Either way
      // what is stored is the better answer; count it as already imported.
      duplicateTrades++
      continue
    }
    restatedTrades.push({ id: row!.id, previousTradeDate: row!.tradeDate, trade })
  }

  // Pass three, on whole days. Where the file states a day's fills as
  // settled, stored fills of that day still unsettled and no longer listed
  // were intraday partials it has regrouped. Where it states them unsettled
  // and storage already holds the day settled, its new rows are those same
  // partials arriving late.
  const fileDays = new Map<string, boolean>()
  for (const trade of parsed.trades) {
    const key = dayKey(trade)
    fileDays.set(key, (fileDays.get(key) ?? true) && trade.isSettled)
  }
  const supersededTrades: StoredTrade[] = []
  const settledDays = new Set<string>()
  for (const row of stored) {
    if (row.isDeleted || row.origin !== 'IMPORT') continue
    const key = dayKey(row)
    if (row.isSettled) settledDays.add(key)
    else if (fileDays.get(key) === true && !claimed.has(row.id) && !row.isEdited) {
      supersededTrades.push(row)
    }
  }
  const lateIntraday = (trade: NormalizedTrade) =>
    !trade.isSettled && fileDays.get(dayKey(trade)) === false && settledDays.has(dayKey(trade))
  duplicateTrades += newTrades.filter(lateIntraday).length
  const inserted = newTrades.filter((trade) => !lateIntraday(trade))

  const seenDividends = new Set(existingDividendHashes)
  const newDividends: NormalizedDividend[] = []
  let duplicateDividends = 0

  for (const payout of parsed.dividends) {
    if (seenDividends.has(payout.sourceRowHash)) {
      duplicateDividends++
      continue
    }
    seenDividends.add(payout.sourceRowHash)
    newDividends.push(payout)
  }

  return {
    newTrades: inserted,
    newDividends,
    restatedTrades,
    settledTrades,
    supersededTrades,
    duplicateTrades,
    duplicateDividends,
    errors: parsed.errors,
  }
}

/** Human-readable summary for the import preview screen. */
export function describePlan(plan: ImportPlan): string {
  const parts = [
    `${plan.newTrades.length} new trade${plan.newTrades.length === 1 ? '' : 's'}`,
  ]
  if (plan.newDividends.length) parts.push(`${plan.newDividends.length} new dividends`)
  if (plan.restatedTrades.length) parts.push(`${plan.restatedTrades.length} restated by the broker`)
  if (plan.settledTrades.length) parts.push(`${plan.settledTrades.length} now settled`)
  if (plan.supersededTrades.length)
    parts.push(`${plan.supersededTrades.length} intraday fills regrouped at settlement`)
  if (plan.duplicateTrades) parts.push(`${plan.duplicateTrades} already imported`)
  if (plan.duplicateDividends) parts.push(`${plan.duplicateDividends} dividends already imported`)
  if (plan.errors.length) parts.push(`${plan.errors.length} unreadable rows`)
  return parts.join(', ')
}
