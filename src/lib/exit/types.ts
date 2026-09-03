/**
 * Types for the swing-trade exit framework.
 *
 * Two ideas run through the whole module and explain most of the shapes here:
 *
 * 1. **Entry facts are locked.** `InitialStop` and the risk unit `R` are fixed
 *    the day the position is opened and never recomputed, so a later shift in
 *    support or volatility cannot retroactively move the stop that was accepted
 *    when the trade was sized. Everything in `ExitRulePosition` is therefore a
 *    stored constant, including the ATR reading taken from the entry-date bar.
 *
 * 2. **Everything else is derived, not stored.** Highest close, whether Target 1
 *    has been reached, and the ratcheting trailing stop are all path-dependent,
 *    but they are pure functions of the bar history — so they are replayed from
 *    the stored feed on every read rather than mutated in place. A backfilled or
 *    corrected payload then simply produces the right answer, where incrementally
 *    updated state would have kept a wrong high-water mark forever.
 */
import type Decimal from 'decimal.js'
import type { AccountType, AssetClass } from '../domain/types'

/** How the trailing stop is computed once Target 1 has been taken. */
export type TrailingMethod = 'ATR' | 'SMA10' | 'SMA20'

export const TRAILING_METHODS: readonly TrailingMethod[] = ['ATR', 'SMA10', 'SMA20']

/**
 * One daily bar as pushed by the TradingView alert.
 *
 * Deliberately only the fields the framework uses. Note the absence of open,
 * high and low: the Pine script publishes a close-only snapshot, which is what
 * makes a true opening gap unobservable — see `GAP_ATR_FRACTION` in `rules.ts`.
 */
export interface FeedBar {
  /** Calendar date of the session, in the *exchange's* timezone. */
  tradingDay: string
  close: Decimal
  sma10: Decimal
  sma20: Decimal
  rsi14: Decimal
  macd: Decimal
  macdSignal: Decimal
  macdHist: Decimal
  atr14: Decimal
}

/** The facts fixed when the position was opened. None of these are recomputed. */
export interface ExitRulePosition {
  symbol: string
  name: string
  assetClass: AssetClass
  accountType: AccountType
  entryDate: string
  entryPrice: Decimal
  /** Shares bought at entry — the denominator for the partial-exit size. */
  totalShares: Decimal
  /**
   * Shares still held, read from the trade history rather than stored.
   *
   * The engine's pool quantity is the truth here: once the Target 1 sell is
   * imported, this drops on its own and the suggested action moves from "take
   * partial" to "trail". A separately stored copy would be one import away from
   * disagreeing with the actual holding.
   */
  sharesRemaining: Decimal
  /** Support identified at entry — the discretionary half of the initial stop. */
  supportLevel: Decimal
  /**
   * ATR(14) from the entry-date bar, or null when no payload covered that day.
   *
   * Null is not an error: an alert set up after the fact never delivers the
   * entry-date bar. The initial stop then falls back to support alone, and the
   * assessment says so rather than quietly substituting a later ATR — which
   * would be exactly the retroactive recalculation the framework forbids.
   */
  entryAtr: Decimal | null
  /** Board-lot size: 100 on 東証, 1 for US shares. */
  lotSize: number
  /** Per-position override; null defers to the global setting. */
  trailingMethod: TrailingMethod | null
}

/** The tunables. Every one of these is adjustable, none are baked into the math. */
export interface ExitSettings {
  /** Target 1 = entry + this × R. Framework range 1.5–2.0. */
  targetMultiple: Decimal
  /** Fraction of the position sold at Target 1. Framework range 0.33–0.50. */
  partialExitFraction: Decimal
  /** Initial stop = entry − this × ATR(14) at entry. */
  initialStopAtrMultiple: Decimal
  /** Chandelier width: highest close − this × ATR(14). */
  trailingAtrMultiple: Decimal
  /** Time stop fires after strictly more than this many trading days. Range 10–15. */
  timeStopDays: number
  trailingMethod: TrailingMethod
  /** Trading days without a payload before the feed counts as stale. */
  staleTradingDays: number
}

export const DEFAULT_EXIT_SETTINGS = {
  targetMultiple: '1.5',
  partialExitFraction: '0.5',
  initialStopAtrMultiple: '1.5',
  trailingAtrMultiple: '3',
  timeStopDays: 12,
  trailingMethod: 'ATR',
  staleTradingDays: 3,
} as const

/**
 * What to do right now. One case per branch of the framework, ordered by
 * urgency in `rules.ts` — a stopped-out position is not also told to "hold".
 */
export type ExitActionKind =
  | 'HOLD'
  | 'TAKE_PARTIAL'
  | 'MOVE_TO_BREAKEVEN'
  | 'TRAIL_ACTIVE'
  | 'STOPPED_OUT'
  | 'STOPPED_OUT_GAP'
  | 'TIME_STOP'
  | 'DATA_STALE'
  | 'AWAITING_FEED'
  | 'POSITION_CLOSED'

export interface ExitAction {
  kind: ExitActionKind
  /** Ready to render — the UI never assembles this from parts. */
  message: string
  /** Drives the badge colour: act now, look soon, or nothing to do. */
  severity: 'urgent' | 'attention' | 'neutral'
}

/** The full evaluation of one position against the rule set. */
export interface ExitAssessment {
  initialStop: Decimal
  /** Risk per share: entry − initial stop. The unit Target 1 is measured in. */
  riskPerShare: Decimal
  target1: Decimal
  /** Rounded down to a whole number of board lots. */
  partialExitShares: Decimal
  target1Hit: boolean
  /** Session on which the close first reached Target 1. */
  target1HitDate: string | null
  /** True once the position has actually been reduced. */
  partialTaken: boolean
  highestClose: Decimal | null
  /** Null until Target 1 is hit — the trail does not run before then. */
  trailingStop: Decimal | null
  trailingActive: boolean
  /** Which method produced the trailing stop, after the per-position override. */
  trailingMethod: TrailingMethod
  currentStop: Decimal
  latestBar: FeedBar | null
  /** Calendar days since entry — what "days held" conventionally means. */
  daysHeld: number
  /** Trading days since entry. The time stop counts in these. */
  tradingDaysHeld: number
  timeStopFlag: boolean
  stale: boolean
  /** Trading days since the last payload; 0 when today's has arrived. */
  staleTradingDays: number
  /** True when no entry-date ATR was available and support alone set the stop. */
  stopFromSupportOnly: boolean
  unrealizedPerShare: Decimal | null
  action: ExitAction
}
