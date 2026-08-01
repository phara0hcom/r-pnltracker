/**
 * Core domain types shared by parsers, the P&L engine, and the UI.
 *
 * Money and quantities are carried as `Decimal` (decimal.js) everywhere inside
 * the engine. Fund unit counts run to 7+ significant digits (e.g. 1,032,403 口)
 * and binary floats accumulate visible drift across 300+ trades, so floats are
 * never used for value-bearing arithmetic.
 */
import Decimal from 'decimal.js'

/** Rakuten tax-shelter buckets. Cost-basis pools are keyed per account type. */
export type AccountType =
  | 'SPECIFIC' // 特定       — taxable, 20.315% withheld at source
  | 'NISA_OLD' // 旧NISA     — legacy NISA, separate from the ¥18M lifetime cap
  | 'NISA_GROWTH' // NISA成長投資枠 — ¥2.4M/yr
  | 'NISA_TSUMITATE' // NISAつみたて投資枠 — ¥1.2M/yr

/** New-NISA frames only. 旧NISA is deliberately excluded — separate system. */
export const NEW_NISA_ACCOUNTS = ['NISA_GROWTH', 'NISA_TSUMITATE'] as const

export const TAX_EXEMPT_ACCOUNTS: readonly AccountType[] = [
  'NISA_OLD',
  'NISA_GROWTH',
  'NISA_TSUMITATE',
]

export type AssetClass = 'JP_EQUITY' | 'US_EQUITY' | 'FUND'

export type Currency = 'JPY' | 'USD'

/**
 * BUY/SELL are cash trades. REINVEST is a fund distribution reinvested into
 * units — it adds units *and* cost basis with no external cash movement.
 * REDEEM (解約) is a fund redemption; economically identical to SELL.
 */
export type TradeSide = 'BUY' | 'SELL' | 'REINVEST' | 'REDEEM'

/** Sides that increase a position. */
export const OPENING_SIDES: readonly TradeSide[] = ['BUY', 'REINVEST']
/** Sides that decrease a position and realize P&L. */
export const CLOSING_SIDES: readonly TradeSide[] = ['SELL', 'REDEEM']

export interface Instrument {
  /** Ticker for equities (`8411`, `AMD`); fund name for投信 (no code in exports). */
  symbol: string
  name: string
  assetClass: AssetClass
  /** Currency the instrument is *quoted* in, not the settlement currency. */
  currency: Currency
  exchange?: string
}

/**
 * One normalized trade. Every parser emits this shape regardless of which of
 * the five Rakuten formats it came from.
 *
 * All amounts are in the instrument's native currency, EXCEPT `netAmountJpy`
 * which is the JPY-converted settlement value used for cost basis.
 */
export interface NormalizedTrade {
  tradeDate: string // 約定日, YYYY-MM-DD
  settleDate: string // 受渡日, YYYY-MM-DD — tax attribution uses this
  symbol: string
  name: string
  assetClass: AssetClass
  accountType: AccountType
  side: TradeSide
  /** Shares, or 口 for funds (already in raw units, not per-10,000). */
  quantity: Decimal
  /** Per *single* unit. Fund 基準価額 is quoted per 10,000 口 and is divided down at parse time. */
  unitPrice: Decimal
  currency: Currency
  /** Brokerage commission, native currency. */
  fee: Decimal
  /** Consumption tax on the commission (JP) or withholding (US). NOT capital gains tax. */
  feeTax: Decimal
  /** 諸費用 / SEC fee. */
  otherCost: Decimal
  /** USD→JPY rate on the trade. 1 for natively-JPY instruments. */
  fxRate: Decimal
  /** qty × unitPrice, native currency, before fees. */
  grossAmount: Decimal
  /** Cash actually paid (buy) or received (sell), native currency. */
  netAmount: Decimal
  /** `netAmount × fxRate`. The value cost basis and realized P&L are tracked in. */
  netAmountJpy: Decimal
  /** False when 受渡金額 was "-" (trade not yet settled); amount was derived. */
  isSettled: boolean
  /** Rakuten points applied to the purchase. Informational — already inside `netAmount`. */
  pointsUsed?: Decimal
  /** sha256 of the identifying fields — makes re-importing overlapping exports idempotent. */
  sourceRowHash: string
  sourceFile: string
}

export type DividendKind = 'DIVIDEND' | 'DISTRIBUTION' // 配当金 | 分配金

export interface NormalizedDividend {
  payDate: string
  symbol: string
  name: string
  accountType: AccountType
  kind: DividendKind
  /** As credited. Rakuten's statement reports the post-withholding figure. */
  netAmount: Decimal
  currency: Currency
  sourceRowHash: string
  sourceFile: string
}

/** Month-end holdings from 取引残高報告書 — used purely to validate the engine. */
export interface PositionSnapshot {
  asOf: string
  symbol: string
  name: string
  accountType: AccountType
  quantity: Decimal
  valuationJpy: Decimal
}

export type CashMovementKind = 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER'

export interface NormalizedCashMovement {
  date: string
  kind: CashMovementKind
  description: string
  amount: Decimal
  currency: Currency
  sourceRowHash: string
}

/** Everything one source file can yield. */
export interface ParseResult {
  trades: NormalizedTrade[]
  dividends: NormalizedDividend[]
  snapshots: PositionSnapshot[]
  cashMovements: NormalizedCashMovement[]
  /** Non-fatal row-level problems. Parsing never throws on a single bad row. */
  errors: ParseError[]
}

export interface ParseError {
  file: string
  line: number
  message: string
  raw?: string
}

export const emptyParseResult = (): ParseResult => ({
  trades: [],
  dividends: [],
  snapshots: [],
  cashMovements: [],
  errors: [],
})

export const ZERO = new Decimal(0)
export const ONE = new Decimal(1)

/** Japanese capital gains: 15% income + 0.315% reconstruction + 5% local. */
export const TAX_RATE_TOTAL = new Decimal('0.20315')
export const TAX_RATE_INCOME = new Decimal('0.15315')
export const TAX_RATE_LOCAL = new Decimal('0.05')

/** Fund 基準価額 is quoted per 10,000 口. */
export const FUND_UNIT_DIVISOR = new Decimal(10_000)
