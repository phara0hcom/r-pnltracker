/**
 * Parsers for Rakuten's three `tradehistory(*)` exports — the authoritative
 * source of trades.
 *
 * Shared quirks handled here:
 *  - 受渡金額 is `"-"` on trades that have not settled yet, so the settlement
 *    amount must be derived from qty/price/fees rather than read.
 *  - Fee signs differ by direction: a buy pays fees on top, a sell nets them off.
 *  - Fund 基準価額 is quoted per 10,000 口.
 */
import Decimal from 'decimal.js'
import { canonicalSymbol } from '../domain/instruments'
import {
  emptyParseResult,
  FUND_UNIT_DIVISOR,
  ONE,
  OPENING_SIDES,
  ZERO,
  type NormalizedTrade,
  type ParseResult,
} from '../domain/types'
import {
  assetClassFor,
  isBlank,
  jtrim,
  makeOccurrenceCounter,
  parseAccountType,
  parseDate,
  parseNum,
  parseNumOrZero,
  parsePointsUsed,
  parseSide,
  rowHash,
  splitCsvLine,
  toHalfWidth,
  toYen,
} from './util'

/** Which of the five formats a file is, decided from its header row. */
export type RakutenFormat = 'JP' | 'US' | 'INVST' | 'TORIZAN' | 'TORIHOU' | 'GAIKABU'

export function detectFormat(text: string): RakutenFormat | null {
  const head = text.slice(0, 4000)
  // Statement files lead with a `---` rule and a section title.
  if (head.includes('お預り残高') || head.includes('取引明細（金銭及び有価証券の推移）')) return 'TORIZAN'
  if (head.includes('外国株式(現物取引)') || head.includes('SECfee')) return 'GAIKABU'
  if (head.includes('国内株式(現物取引)')) return 'TORIHOU'
  // Trade history files lead with their column header.
  const first = head.split(/\r?\n/, 1)[0] ?? ''
  if (first.includes('ティッカー')) return 'US'
  if (first.includes('銘柄コード')) return 'JP'
  if (first.includes('ファンド名')) return 'INVST'
  return null
}

/** Rows whose non-empty cells are all blank markers — trailing junk. */
function isEmptyRow(cols: string[]): boolean {
  return cols.every((cell) => jtrim(cell) === '')
}

/**
 * 国内株式 — `tradehistory(JP)_*.csv`
 *
 * Verified against all 65 settled rows:
 *   buy  受渡金額 = qty×price + 手数料 + 税金等 + 諸費用
 *   sell 受渡金額 = qty×price − 手数料 − 税金等 − 諸費用
 *
 * Note 税金等 here is *consumption tax on the commission* (exactly 10% of it),
 * not capital gains tax. Capital gains withholding is not in this export at all.
 */
export function parseJpTradeHistory(text: string, sourceFile: string): ParseResult {
  const result = emptyParseResult()
  const lines = text.split(/\r?\n/)
  const occurrence = makeOccurrenceCounter()

  for (let lineNo = 1; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo]!
    if (jtrim(line) === '') continue
    const cols = splitCsvLine(line)
    if (isEmptyRow(cols)) continue

    const tradeDate = parseDate(cols[0])
    const settleDate = parseDate(cols[1])
    const code = toHalfWidth(cols[2] ?? '')
    const name = jtrim(cols[3])
    const accountType = parseAccountType(cols[5])
    const side = parseSide(cols[7])
    const quantity = parseNum(cols[10])
    const unitPrice = parseNum(cols[11])

    if (!tradeDate || !code || !accountType || !side || !quantity || !unitPrice) {
      result.errors.push({
        file: sourceFile,
        line: lineNo + 1,
        message: 'missing required field (date/code/account/side/qty/price)',
        raw: line.slice(0, 200),
      })
      continue
    }

    // 信用 (margin) rows carry a 建約定日; none exist in the current data, but
    // silently folding them into cash positions would corrupt cost basis.
    if (!isBlank(cols[8]) && jtrim(cols[8]) !== '現物' && !isBlank(cols[17])) {
      result.errors.push({
        file: sourceFile,
        line: lineNo + 1,
        message: `margin trade not supported (信用区分=${jtrim(cols[8])})`,
        raw: line.slice(0, 200),
      })
      continue
    }

    const fee = parseNumOrZero(cols[12])
    const feeTax = parseNumOrZero(cols[13])
    const otherCost = parseNumOrZero(cols[14])
    const gross = quantity.mul(unitPrice)
    const costs = fee.add(feeTax).add(otherCost)

    const reported = parseNum(cols[16])
    const derived = side === 'BUY' ? gross.add(costs) : gross.sub(costs)
    // Trust the derived figure; `reported` is absent on unsettled rows.
    const netAmount = reported ?? derived
    const isSettled = reported != null

    result.trades.push({
      tradeDate,
      settleDate: settleDate ?? tradeDate,
      symbol: code,
      name,
      assetClass: assetClassFor('JP'),
      accountType,
      side,
      quantity,
      unitPrice,
      currency: 'JPY',
      fee,
      feeTax,
      otherCost,
      fxRate: ONE,
      grossAmount: gross,
      netAmount,
      netAmountJpy: netAmount,
      isSettled,
      sourceRowHash: rowHash([
        'JP',
        tradeDate,
        code,
        accountType,
        side,
        quantity,
        unitPrice,
        occurrence(`${tradeDate}|${code}|${accountType}|${side}|${quantity.toFixed()}|${unitPrice.toFixed()}`),
      ]),
      sourceFile,
    })
  }

  return result
}

/**
 * 外国株式 — `tradehistory(US)_*.csv`
 *
 * Settlement is in either JPY or USD depending on 決済通貨; exactly one of the
 * two amount columns is populated and the other is `"-"`. Cost basis is always
 * tracked in JPY via the row's own 為替レート, which is how Japanese tax
 * treatment works — FX movement is part of the taxable gain.
 */
export function parseUsTradeHistory(text: string, sourceFile: string): ParseResult {
  const result = emptyParseResult()
  const lines = text.split(/\r?\n/)
  const occurrence = makeOccurrenceCounter()

  for (let lineNo = 1; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo]!
    if (jtrim(line) === '') continue
    const cols = splitCsvLine(line)
    if (isEmptyRow(cols)) continue

    const tradeDate = parseDate(cols[0])
    const settleDate = parseDate(cols[1])
    const ticker = toHalfWidth(cols[2] ?? '')
    const name = jtrim(cols[3])
    const accountType = parseAccountType(cols[4])
    const side = parseSide(cols[6])
    const quantity = parseNum(cols[10])
    const unitPrice = parseNum(cols[11])
    const fxRate = parseNum(cols[13])

    if (!tradeDate || !ticker || !accountType || !side || !quantity || !unitPrice || !fxRate) {
      result.errors.push({
        file: sourceFile,
        line: lineNo + 1,
        message: 'missing required field (date/ticker/account/side/qty/price/fx)',
        raw: line.slice(0, 200),
      })
      continue
    }

    const fee = parseNumOrZero(cols[14])
    const tax = parseNumOrZero(cols[15])
    // 約定代金 is authoritative for gross; fall back to qty×price if absent.
    const gross = parseNum(cols[12]) ?? quantity.mul(unitPrice)
    const costs = fee.add(tax)
    const netUsd = side === 'BUY' ? gross.add(costs) : gross.sub(costs)

    // Prefer Rakuten's own JPY settlement figure when the trade settled in yen;
    // otherwise convert at the trade's rate.
    const reportedJpy = parseNum(cols[17])
    const reportedUsd = parseNum(cols[16])
    // JPY is zero-decimal — an FX conversion must land on whole yen before it
    // reaches cost basis or NISA quota arithmetic.
    const netAmountJpy = toYen(reportedJpy ?? netUsd.mul(fxRate))
    const isSettled = reportedJpy != null || reportedUsd != null

    result.trades.push({
      tradeDate,
      settleDate: settleDate ?? tradeDate,
      symbol: ticker,
      name,
      assetClass: assetClassFor('US'),
      accountType,
      side,
      quantity,
      unitPrice,
      currency: 'USD',
      fee,
      feeTax: tax,
      otherCost: ZERO,
      fxRate,
      grossAmount: gross,
      netAmount: netUsd,
      netAmountJpy,
      isSettled,
      sourceRowHash: rowHash([
        'US',
        tradeDate,
        ticker,
        accountType,
        side,
        quantity,
        unitPrice,
        occurrence(`${tradeDate}|${ticker}|${accountType}|${side}|${quantity.toFixed()}|${unitPrice.toFixed()}`),
      ]),
      sourceFile,
    })
  }

  return result
}

/**
 * 投資信託 — `tradehistory(INVST)_*.csv`
 *
 * 基準価額 is quoted per 10,000 口, so the per-unit price is divided down.
 * Verified: 96,016 口 @ 20,830 → ¥200,000.
 *
 * `再投資` rows are distributions reinvested into units. They carry a real
 * acquisition cost (the distribution amount) even though no external cash
 * moves, so they must increase cost basis — otherwise fund gains are inflated.
 */
export function parseFundTradeHistory(text: string, sourceFile: string): ParseResult {
  const result = emptyParseResult()
  const lines = text.split(/\r?\n/)
  const occurrence = makeOccurrenceCounter()

  for (let lineNo = 1; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo]!
    if (jtrim(line) === '') continue
    const cols = splitCsvLine(line)
    if (isEmptyRow(cols)) continue

    const tradeDate = parseDate(cols[0])
    const settleDate = parseDate(cols[1])
    const fundName = jtrim(cols[2])
    const accountType = parseAccountType(cols[4])
    const side = parseSide(cols[5])
    const quantity = parseNum(cols[7])
    const rawPrice = parseNum(cols[8])

    if (!tradeDate || !fundName || !accountType || !side || !quantity || !rawPrice) {
      result.errors.push({
        file: sourceFile,
        line: lineNo + 1,
        message: 'missing required field (date/fund/account/side/qty/price)',
        raw: line.slice(0, 200),
      })
      continue
    }

    const unitPrice = rawPrice.div(FUND_UNIT_DIVISOR)
    const fee = parseNumOrZero(cols[9]) // 経費
    const gross = quantity.mul(unitPrice)
    // Rakuten points applied to the purchase; part of acquisition cost, so this
    // is informational only and never reduces basis.
    const pointsUsed = parsePointsUsed(cols[12])
    // Funds are identified by name, so a rename must fold onto the surviving one.
    const symbol = canonicalSymbol(fundName)

    // 受渡金額[円] is the cash actually moved; for 再投資 it equals the
    // distribution being rolled in, which is exactly the acquisition cost.
    //
    // The fallback keys off OPENING_SIDES, not `side === 'BUY'`: 再投資 also
    // acquires units, so its fee is part of acquisition cost and adds. Testing
    // BUY alone silently pushed REINVEST into the disposal branch.
    const reported = parseNum(cols[12])
    const netAmount = toYen(
      reported ?? (OPENING_SIDES.includes(side) ? gross.add(fee) : gross.sub(fee)),
    )

    result.trades.push({
      tradeDate,
      settleDate: settleDate ?? tradeDate,
      symbol,
      name: fundName,
      assetClass: assetClassFor('FUND'),
      accountType,
      side,
      quantity,
      unitPrice,
      currency: 'JPY',
      fee,
      feeTax: ZERO,
      otherCost: ZERO,
      fxRate: ONE,
      grossAmount: gross,
      netAmount,
      netAmountJpy: netAmount,
      isSettled: reported != null,
      pointsUsed: pointsUsed ?? undefined,
      sourceRowHash: rowHash([
        'FUND',
        tradeDate,
        fundName,
        accountType,
        side,
        quantity,
        rawPrice,
        occurrence(`${tradeDate}|${fundName}|${accountType}|${side}|${quantity.toFixed()}|${rawPrice.toFixed()}`),
      ]),
      sourceFile,
    })
  }

  return result
}

/** Dispatch on detected format. Statement formats are handled elsewhere. */
export function parseTradeHistory(text: string, sourceFile: string): ParseResult {
  const fmt = detectFormat(text)
  switch (fmt) {
    case 'JP':
      return parseJpTradeHistory(text, sourceFile)
    case 'US':
      return parseUsTradeHistory(text, sourceFile)
    case 'INVST':
      return parseFundTradeHistory(text, sourceFile)
    // Statement formats are parsed elsewhere; naming them keeps this switch
    // exhaustive so a new format cannot be added without a decision here.
    case 'TORIZAN':
    case 'TORIHOU':
    case 'GAIKABU':
    case null:
    default: {
      const result = emptyParseResult()
      result.errors.push({
        file: sourceFile,
        line: 0,
        message: `not a tradehistory file (detected: ${fmt ?? 'unknown'})`,
      })
      return result
    }
  }
}

/** Sum helper used by tests and reporting. */
export function sumJpy(trades: NormalizedTrade[]): Decimal {
  return trades.reduce((running, trade) => running.add(trade.netAmountJpy), new Decimal(0))
}
