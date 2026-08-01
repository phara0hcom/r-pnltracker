/**
 * 取引残高報告書 (`*_torizan.csv`) — the monthly statement.
 *
 * This file is not a single table. It is ~8 sections, each with its own header
 * row, separated by `-----` rules, so it is walked as a state machine rather
 * than parsed as CSV.
 *
 * Two sections matter:
 *   お預り残高                        → month-end holdings (validation oracle)
 *   取引明細（金銭及び有価証券の推移）  → cash ledger, the ONLY source of dividends
 *
 * The cash ledger is further split by currency with `【円】` / `【ＵＳドル…】`
 * marker rows, so the active currency is tracked while walking.
 */
import type Decimal from 'decimal.js'
import {
  emptyParseResult,
  FUND_UNIT_DIVISOR,
  type AssetClass,
  type CashMovementKind,
  type Currency,
  type DividendKind,
  type ParseResult,
} from '../domain/types'
import {
  extractCode,
  isBlank,
  isSeparator,
  jtrim,
  parseAccountType,
  parseDate,
  parseNum,
  rowHash,
  splitCsvLine,
  toHalfWidth,
} from './util'

type Section = 'NONE' | 'HOLDINGS' | 'CASH_LEDGER' | 'OTHER'

const SECTION_TITLES: Record<string, Section> = {
  お預り残高: 'HOLDINGS',
  '取引明細（金銭及び有価証券の推移）': 'CASH_LEDGER',
}

/** 商品等 column in the holdings table → asset class. */
function holdingAssetClass(shohin: string): AssetClass | null {
  const t = jtrim(shohin)
  if (t.includes('国内株式')) return 'JP_EQUITY'
  if (t.includes('外国株式')) return 'US_EQUITY'
  if (t.includes('国内投信') || t.includes('外国投信')) return 'FUND'
  return null // 金銭等 (cash), 債券, etc.
}

/** Currency marker rows look like `【円】` or `【ＵＳドル　　（USD ）】`. */
function currencyFromMarker(cell: string): Currency | null {
  const t = toHalfWidth(cell)
  if (!t.includes('【')) return null
  if (t.includes('USD') || t.includes('ドル')) return 'USD'
  if (t.includes('円')) return 'JPY'
  return null
}

function cashKind(torihiki: string): CashMovementKind | null {
  const t = jtrim(torihiki).replace(/\s|　/g, '')
  if (t === '入金') return 'DEPOSIT'
  if (t === '出金') return 'WITHDRAWAL'
  if (t === '振替' || t === '振替出金' || t === '振替入金') return 'TRANSFER'
  return null
}

function dividendKind(torihiki: string): DividendKind | null {
  const t = jtrim(torihiki).replace(/\s|　/g, '')
  if (t === '配当金') return 'DIVIDEND'
  if (t === '分配金') return 'DISTRIBUTION'
  return null
}

export function parseTorizan(text: string, sourceFile: string): ParseResult {
  const result = emptyParseResult()
  const lines = text.split(/\r?\n/)

  // Statement is dated by filename: `20260630_torizan.csv`.
  const fnMatch = /(\d{4})(\d{2})(\d{2})/.exec(sourceFile)
  const asOf = fnMatch ? `${fnMatch[1]!}-${fnMatch[2]!}-${fnMatch[3]!}` : null

  let section: Section = 'NONE'
  let sawHeader = false
  let ledgerCurrency: Currency = 'JPY'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (jtrim(line) === '') continue

    if (isSeparator(line)) {
      section = 'NONE'
      sawHeader = false
      continue
    }

    const cols = splitCsvLine(line)
    const first = jtrim(cols[0]);

    // A lone cell on a line is a section title.
    if (cols.filter((c) => jtrim(c) !== '').length === 1 && first !== '') {
      section = SECTION_TITLES[first] ?? 'OTHER'
      sawHeader = false
      continue
    }

    if (section === 'NONE' || section === 'OTHER') continue

    // First row after a section title is its column header.
    if (!sawHeader) {
      sawHeader = true
      continue
    }

    if (section === 'HOLDINGS') {
      parseHoldingRow(cols, asOf, sourceFile, result)
    } else {
      const marker = currencyFromMarker(cols[2] ?? '')
      if (marker && isBlank(cols[0])) {
        // Currency divider row — switches the ledger's active currency.
        ledgerCurrency = marker
        continue
      }
      parseLedgerRow(cols, ledgerCurrency, sourceFile, result, i + 1)
    }
  }

  return result
}

/**
 * Holdings row:
 * 商品等, 口座, 銘柄名（銘柄コード）, 数量, 単位, 口／額面, 評価単価, 通貨, 評価金額, 通貨, 備考
 */
function parseHoldingRow(
  cols: string[],
  asOf: string | null,
  sourceFile: string,
  result: ParseResult,
): void {
  if (!asOf) return
  const assetClass = holdingAssetClass(cols[0] ?? '')
  if (!assetClass) return // cash rows and other products

  const accountType = parseAccountType(cols[1])
  if (!accountType) return

  const { name, code } = extractCode(cols[2] ?? '')
  const quantity = parseNum(cols[3])
  const valuation = parseNum(cols[8])
  if (!quantity || !valuation) return

  // Equities carry a (code); funds have none, so the name is the identity —
  // matching how the fund trade history identifies them.
  const symbol = code ? toHalfWidth(code) : normalizeFundName(name)

  result.snapshots.push({
    asOf,
    symbol,
    name: jtrim(name),
    accountType,
    quantity,
    valuationJpy: valuation,
  })
  void sourceFile
}

/**
 * The statement abbreviates fund names (`楽天Ｐ日経２２５`) while the trade
 * history spells them out (`楽天・プラス・日経225インデックス・ファンド…`).
 * Snapshots are only used for validation, so the abbreviated form is kept and
 * reconciled by a lookup table in the validation test rather than guessed here.
 */
function normalizeFundName(name: string): string {
  return toHalfWidth(name).replace(/再投資コース$/, '').trim()
}

/**
 * Cash ledger row:
 * 受渡年月日, 約定年月日, 通貨名, 取引, 商品, 摘要・銘柄名, 数量, 単位,
 * 単価, 通貨（単価）, お預り金の減少, お預り金の増加
 */
function parseLedgerRow(
  cols: string[],
  currency: Currency,
  sourceFile: string,
  result: ParseResult,
  lineNo: number,
): void {
  const date = parseDate(cols[0])
  const torihiki = jtrim(cols[3])
  if (!date || torihiki === '') return

  const decrease = parseNum(cols[10])
  const increase = parseNum(cols[11])

  const dk = dividendKind(torihiki)
  if (dk) {
    // Dividends land as a credit; Rakuten reports the post-withholding figure.
    const amount = increase ?? decrease
    if (!amount) {
      result.errors.push({
        file: sourceFile,
        line: lineNo,
        message: `dividend row with no amount (${torihiki})`,
      })
      return
    }
    const name = normalizeFundName(jtrim(cols[5]))
    result.dividends.push({
      payDate: date,
      symbol: name,
      name,
      // The ledger does not carry an account column; attribution is resolved
      // later by matching the instrument against held positions.
      accountType: 'SPECIFIC',
      kind: dk,
      netAmount: amount,
      currency,
      sourceRowHash: rowHash(['DIV', date, name, dk, amount, currency]),
      sourceFile,
    })
    return
  }

  const ck = cashKind(torihiki)
  if (ck) {
    const amount = increase ?? decrease?.neg()
    if (!amount) return
    result.cashMovements.push({
      date,
      kind: ck,
      description: jtrim(cols[5]),
      amount,
      currency,
      sourceRowHash: rowHash(['CASH', date, torihiki, jtrim(cols[5]), amount, currency]),
    })
  }
  // Trade rows (特定買付 / Ｎ積立買付 / 特定再投資 / …) are intentionally ignored:
  // `tradehistory` is authoritative for trades and already covers them.
}

/** Exposed for the validation test that reconciles snapshots against the engine. */
export const FUND_UNIT_DIVISOR_FOR_SNAPSHOTS = FUND_UNIT_DIVISOR
export type { Decimal }
