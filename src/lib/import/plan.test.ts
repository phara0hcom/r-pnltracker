/**
 * Re-import safety.
 *
 * These simulate what actually happens in use: exporting fresh CSVs from
 * Rakuten every few weeks, where each new export overlaps everything before it.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyParseResult, type ParseResult } from '../domain/types'
import {
  asStored,
  loadAllStatements,
  loadAllTrades,
  readShiftJisFile,
  torizanFiles,
  tradeHistoryFiles,
} from './loadFixtures'
import { orderFilesForImport, planImport } from './plan'
import { parseTorizan } from './torizan'
import { parseTradeHistory } from './tradeHistory'

const fresh = loadAllTrades()
const statements = loadAllStatements()

/** Re-parse a single file, as an upload would. */
function parseFile(path: string): ParseResult {
  return parseTradeHistory(readShiftJisFile(path), basename(path))
}

describe('first import', () => {
  it('accepts everything into an empty database', () => {
    const plan = planImport(fresh, [])
    expect(plan.newTrades).toHaveLength(315)
    expect(plan.duplicateTrades).toBe(0)
    expect(plan.restatedTrades).toEqual([])
    expect(plan.errors).toEqual([])
  })
})

describe('re-importing the same files', () => {
  it('adds nothing the second time', () => {
    const stored = asStored(fresh.trades)
    const plan = planImport(loadAllTrades(), stored)
    expect(plan.newTrades).toHaveLength(0)
    expect(plan.duplicateTrades).toBe(315)
    // Nothing in the genuine history looks like a restatement of anything else.
    expect(plan.restatedTrades).toEqual([])
  })

  it('adds nothing on a third and fourth run either', () => {
    let stored = asStored([])
    const insertedPerRun: number[] = []
    for (let run = 0; run < 4; run++) {
      const plan = planImport(loadAllTrades(), stored)
      insertedPerRun.push(plan.newTrades.length)
      expect(plan.restatedTrades).toEqual([])
      stored = stored.concat(asStored(plan.newTrades))
    }
    // Everything lands on the first pass; every later pass is a no-op.
    expect(insertedPerRun).toEqual([315, 0, 0, 0])
    expect(stored).toHaveLength(315)
  })

  it('is stable per file, not just in aggregate', () => {
    for (const path of tradeHistoryFiles()) {
      const first = parseFile(path)
      const stored = asStored(first.trades)
      const second = planImport(parseFile(path), stored)
      expect(second.newTrades).toHaveLength(0)
      expect(second.duplicateTrades).toBe(first.trades.length)
    }
  })
})

describe('overlapping exports', () => {
  it('adds only the genuinely new trades from a later export', () => {
    // Simulates: imported everything through 2026-06-30, then exported again
    // later. The new file repeats all the old rows plus some new ones.
    const cutoff = '2026-06-30'
    const earlier = fresh.trades.filter((trade) => trade.tradeDate <= cutoff)
    const stored = asStored(earlier)
    const expectedNew = fresh.trades.length - earlier.length
    expect(expectedNew).toBeGreaterThan(0)

    const plan = planImport(loadAllTrades(), stored)
    expect(plan.newTrades).toHaveLength(expectedNew)
    expect(plan.duplicateTrades).toBe(earlier.length)
    // Nothing already stored may reappear.
    for (const t of plan.newTrades) expect(t.tradeDate > cutoff).toBe(true)
  })

  it('keeps all executions of a split order across a re-import', () => {
    // KO was filled 8 times on 2026-07-21, and 3 of those fills are byte-identical
    // (1 share @ $85.58). A date-filtered export contains either all of a day's
    // fills or none, so their ordinals — and therefore their hashes — match
    // between a partial export and a full one.
    const ko = fresh.trades.filter((trade) => trade.symbol === 'KO' && trade.tradeDate === '2026-07-21')
    expect(ko).toHaveLength(8)

    const identical = ko.filter((trade) => trade.quantity.eq(1) && trade.unitPrice.eq('85.58'))
    expect(identical).toHaveLength(3)

    // Every fill must remain individually addressable.
    expect(new Set(ko.map((trade) => trade.sourceRowHash)).size).toBe(8)

    // Re-importing must not duplicate them.
    const stored = asStored(fresh.trades)
    const plan = planImport(loadAllTrades(), stored)
    expect(plan.newTrades.filter((trade) => trade.symbol === 'KO')).toHaveLength(0)
  })

  it('deduplicates within a single upload of the same file twice', () => {
    // Uploading the same file twice in one batch must not double-insert.
    const path = tradeHistoryFiles()[0]!
    const a = parseFile(path)
    const combined = emptyParseResult()
    combined.trades.push(...a.trades, ...parseFile(path).trades)
    const plan = planImport(combined, [])
    expect(plan.newTrades).toHaveLength(a.trades.length)
    expect(plan.duplicateTrades).toBe(a.trades.length)
  })
})

describe('dividends', () => {
  it('does not re-add dividends from overlapping monthly statements', () => {
    const stored = new Set(statements.dividends.map((day) => day.sourceRowHash))
    const again = loadAllStatements()
    const plan = planImport(again, [], stored)
    expect(plan.newDividends).toHaveLength(0)
    expect(plan.duplicateDividends).toBe(6)
  })

  it('accepts dividends from a statement not yet imported', () => {
    const files = torizanFiles()
    const allButLast = files.slice(0, -1)
    const stored = new Set(
      allButLast
        .flatMap((point) => parseTorizan(readShiftJisFile(point), basename(point)).dividends)
        .map((day) => day.sourceRowHash),
    )
    const last = parseTorizan(readShiftJisFile(files.at(-1)!), basename(files.at(-1)!))
    const plan = planImport(last, [], stored)
    // The June 2026 statement carries the ¥14,500 みずほ dividend.
    expect(plan.newDividends.length).toBeGreaterThan(0)
  })
})

describe('commit ordering', () => {
  /** Raw bytes, as an upload delivers them — the parser reads them undecoded. */
  const load = (path: string) => ({ filename: basename(path), bytes: readFileSync(path) })

  it('puts trade histories ahead of statements however they were dropped in', () => {
    const statement = load(torizanFiles()[0]!)
    const history = load(tradeHistoryFiles()[0]!)

    // Worst case: the user drags the statement in first.
    const ordered = orderFilesForImport([statement, history])
    expect(ordered.map((file) => file.filename)).toEqual([history.filename, statement.filename])
  })

  it('leaves files of the same kind in the order they were given', () => {
    const histories = tradeHistoryFiles().map(load)
    expect(orderFilesForImport(histories).map((file) => file.filename)).toEqual(
      histories.map((file) => file.filename),
    )

    const statements = torizanFiles().map(load)
    expect(orderFilesForImport(statements).map((file) => file.filename)).toEqual(
      statements.map((file) => file.filename),
    )
  })
})

describe('points are handled on any future import, not just the known rows', () => {
  it('parses the point format generically', () => {
    // The fix lives in the shared number parser, so it applies to every column
    // of every format — not a patch of two known values.
    const plan = planImport(loadAllTrades(), [])
    const withPoints = plan.newTrades.filter((trade) => trade.pointsUsed)
    expect(withPoints).toHaveLength(2)
    for (const t of plan.newTrades) {
      expect(t.netAmountJpy.abs().lt(50_000_000)).toBe(true)
    }
  })
})

/**
 * Rakuten restates US fills after they settle.
 *
 * The rows below are the production CAG sell, byte-for-byte, as it appeared in
 * `tradehistory(US)_20260904.csv` and then in `tradehistory(US)_20260910.csv`
 * six days later: the same 250 shares at the same price settling on the same
 * day, re-dated from the US trading day to the JST one and repriced at the
 * settlement FX rate. The hash covers the trade date, so the second export
 * looked like a new sell, the sell was stored twice, and the engine warned
 * `close with no open position` on the copy — Sentry issue 7727912391.
 */
describe('broker restatements', () => {
  const US_HEADER =
    '約定日,受渡日,ティッカー,銘柄名,口座,取引区分,売買区分,信用区分,弁済期限,決済通貨,' +
    '数量［株］,単価［USドル］,約定代金［USドル］,為替レート,手数料［USドル］,税金［USドル］,' +
    '受渡金額［USドル］,受渡金額［円］'

  /** One CAG sell row. Only 約定日 and 為替レート move between the exports. */
  const sell = (tradeDate: string, fxRate: string) =>
    `"${tradeDate}","2026/9/8","CAG","CONAGRA BRANDS","特定","現物","売付","-","-","ＵＳドル",` +
    `"250","15.8900","3,972.50","${fxRate}","17.96","1.78","3,952.76","-"`

  const exportOf = (filename: string, rows: string[]) =>
    parseTradeHistory([US_HEADER, ...rows].join('\n'), filename)

  const beforeSettlement = () => exportOf('tradehistory(US)_20260904.csv', [sell('2026/9/3', '155.340')])
  const afterSettlement = () => exportOf('tradehistory(US)_20260910.csv', [sell('2026/9/4', '155.640')])

  it('updates the stored fill rather than adding a second one', () => {
    const stored = asStored(beforeSettlement().trades)
    expect(stored).toHaveLength(1)

    const plan = planImport(afterSettlement(), stored)
    expect(plan.newTrades).toHaveLength(0)
    expect(plan.restatedTrades).toHaveLength(1)

    const [restated] = plan.restatedTrades
    expect(restated!.id).toBe(stored[0]!.id)
    expect(restated!.previousTradeDate).toBe('2026-09-03')
    expect(restated!.trade.tradeDate).toBe('2026-09-04')
    // The settlement rate replaces the provisional one, and with it the yen
    // cost basis: ¥614,022 derived at 155.340 → ¥615,208 actually settled.
    expect(restated!.trade.netAmountJpy.toFixed()).toBe('615208')
  })

  it('does not let an older export undo the restatement', () => {
    // Re-uploading the pre-settlement file afterwards — easy to do, since the
    // whole folder gets dragged in — must not revert the row or add a copy.
    const stored = asStored(afterSettlement().trades)
    const plan = planImport(beforeSettlement(), stored)
    expect(plan.newTrades).toHaveLength(0)
    expect(plan.restatedTrades).toHaveLength(0)
    expect(plan.duplicateTrades).toBe(1)
  })

  it('leaves a hand-corrected row alone', () => {
    const stored = asStored(beforeSettlement().trades, { isEdited: true })
    const plan = planImport(afterSettlement(), stored)
    expect(plan.restatedTrades).toHaveLength(0)
    expect(plan.newTrades).toHaveLength(0)
    expect(plan.duplicateTrades).toBe(1)
  })

  it('never touches a manual trade', () => {
    // Rule 1 of manual entry: an import neither matches nor rewrites one. The
    // hand-entered row stands and the export's own row is added beside it.
    const stored = asStored(beforeSettlement().trades, { origin: 'MANUAL' })
    const plan = planImport(afterSettlement(), stored)
    expect(plan.restatedTrades).toHaveLength(0)
    expect(plan.newTrades).toHaveLength(1)
  })

  it('keeps a second same-day fill, which is a split order and not a restatement', () => {
    // Identical rows on one date are distinct executions, separated by the
    // occurrence ordinal. Only a *different* trade date means a restatement.
    const first = exportOf('a.csv', [sell('2026/9/3', '155.340')])
    const both = exportOf('b.csv', [sell('2026/9/3', '155.340'), sell('2026/9/3', '155.340')])

    const plan = planImport(both, asStored(first.trades))
    expect(plan.newTrades).toHaveLength(1)
    expect(plan.restatedTrades).toHaveLength(0)
    expect(plan.duplicateTrades).toBe(1)
  })

  it('pairs the executions of a split order one for one', () => {
    // Both fills of a two-fill order get re-dated together. Candidates are
    // consumed as they match, so neither collapses onto the other.
    const before = exportOf('a.csv', [sell('2026/9/3', '155.340'), sell('2026/9/3', '155.340')])
    const after = exportOf('b.csv', [sell('2026/9/4', '155.640'), sell('2026/9/4', '155.640')])

    const stored = asStored(before.trades)
    const plan = planImport(after, stored)
    expect(plan.newTrades).toHaveLength(0)
    expect(plan.restatedTrades).toHaveLength(2)
    expect(new Set(plan.restatedTrades.map((row) => row.id))).toEqual(
      new Set(stored.map((row) => row.id)),
    )
  })

  it('still adds a fill that only looks similar', () => {
    // Same instrument, account, side, quantity and price, one day apart — but
    // settling a day apart too, so these are two real trades.
    const monday = exportOf('a.csv', [sell('2026/9/3', '155.340')])
    const tuesday = parseTradeHistory(
      [
        US_HEADER,
        `"2026/9/4","2026/9/9","CAG","CONAGRA BRANDS","特定","現物","売付","-","-","ＵＳドル",` +
          `"250","15.8900","3,972.50","155.640","17.96","1.78","3,952.76","-"`,
      ].join('\n'),
      'b.csv',
    )

    const plan = planImport(tuesday, asStored(monday.trades))
    expect(plan.restatedTrades).toHaveLength(0)
    expect(plan.newTrades).toHaveLength(1)
  })
})
