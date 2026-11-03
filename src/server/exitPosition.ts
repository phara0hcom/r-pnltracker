/**
 * Builds the pure `assess()` input from a stored plan plus the live facts that
 * change independently of it, and the two small steps around that every
 * call site needs.
 *
 * Shared by `server/exit.ts` (the screen), `server/playbookView.ts` (the
 * Playbook) and `server/exitNotifications.ts` (the webhook-triggered notifier)
 * so the rationale behind each field — why `sharesSold` rather than
 * `sharesRemaining < totalShares` says a partial was taken, why a later streak
 * entry date means the plan is superseded — is written once rather than
 * drifting between call sites. Only `import type` reaches `~/db/exit.service`,
 * so this module carries no server-only code into anything that imports it —
 * see `docs/server-only-modules.md`.
 */
import Decimal from 'decimal.js'
import type { ExitRuleRecord } from '~/db/exit.service'
import type { AccountType, AssetClass } from '~/lib/domain/types'
import { calendarFor, todayFor } from '~/lib/exit/calendar'
import { openEntryStreaks, streakFor, type EntryStreak } from '~/lib/exit/entry'
import { assess } from '~/lib/exit/rules'
import type {
  ExitActionKind,
  ExitAssessment,
  ExitRulePosition,
  ExitSettings,
  FeedBar,
  TrailingMethod,
} from '~/lib/exit/types'
import {
  planShares,
  resolvePosition,
  type HoldingStreak,
  type Resolution,
  type TypedLeg,
} from '~/lib/playbook/streaks'
import type { JournalKind } from '~/lib/playbook/types'
import { poolKey } from '~/lib/pnl/engine'

/** The facts about a plan's holding that move without the plan moving. */
export interface HoldingFacts {
  sharesRemaining: Decimal
  sharesSold: Decimal
  currentStreakEntryDate: string | null
  priorCloseDate: string | null
}

export function buildExitRulePosition(rule: ExitRuleRecord, facts: HoldingFacts): ExitRulePosition {
  return {
    symbol: rule.symbol,
    name: rule.name,
    assetClass: rule.assetClass,
    accountType: rule.accountType,
    entryDate: rule.entryDate,
    entryPrice: rule.entryPrice,
    totalShares: rule.totalShares,
    sharesRemaining: facts.sharesRemaining,
    sharesSold: facts.sharesSold,
    supportLevel: rule.supportLevel,
    currentStreakEntryDate: facts.currentStreakEntryDate,
    priorCloseDate: facts.priorCloseDate,
    entryAtr: rule.entryAtr,
    entryStopAtrMultiple: rule.entryStopAtrMultiple,
    entryTargetMultiple: rule.entryTargetMultiple,
    target1Override: rule.target1Override,
    lotSize: rule.lotSize,
    trailingMethod: rule.trailingMethod,
  }
}

/** `(symbol × accountType) → quantity held`, the shape a plan with no position reads `sharesRemaining` from. */
export function positionsByPool(
  positions: { symbol: string; accountType: AccountType; quantity: Decimal }[],
): Map<string, Decimal> {
  return new Map(
    positions.map((position) => [poolKey(position.symbol, position.accountType), position.quantity]),
  )
}

/** What a filed plan's position resolves to, and its typed legs while it waits for its trades. */
export interface FiledHolding {
  resolution: Resolution
  typed: Pick<TypedLeg, 'side' | 'quantity'>[]
}

/** Everything an evaluation reads beyond the plan and its bars. */
export interface HoldingContext {
  heldBy: Map<string, Decimal>
  streaks: Map<string, EntryStreak>
  filed: Map<string, FiledHolding>
}

/** The fields of a stored position this module reads. */
interface FiledPosition {
  id: string
  kind: JournalKind
  symbol: string
  assetClass: AssetClass
  accountType: AccountType | null
  entryDate: string
  anchorTradeId: string | null
  legs: { side: 'ENTRY' | 'EXIT'; firstTradeId: string | null; quantity: Decimal | null }[]
}

/**
 * What each real position resolves to, for `holdingContext`. Archived ones
 * included: a plan outlives neither, but a plan still points at its position
 * whichever state it is in.
 */
export function filedHoldings(
  entries: readonly FiledPosition[],
  streaks: readonly HoldingStreak[],
): Map<string, FiledHolding> {
  const out = new Map<string, FiledHolding>()
  for (const entry of entries) {
    if (entry.kind !== 'REAL' || !entry.accountType) continue
    out.set(entry.id, {
      resolution: resolvePosition({ ...entry, accountType: entry.accountType }, streaks),
      typed: entry.legs.filter((leg) => leg.firstTradeId === null),
    })
  }
  return out
}

/** Built once per request by each caller, from the trades it already holds. */
export function holdingContext(
  positions: { symbol: string; accountType: AccountType; quantity: Decimal }[],
  trades: Parameters<typeof openEntryStreaks>[0],
  entries: readonly FiledPosition[],
  allStreaks: readonly HoldingStreak[],
): HoldingContext {
  return {
    heldBy: positionsByPool(positions),
    streaks: openEntryStreaks(trades),
    filed: filedHoldings(entries, allStreaks),
  }
}

/**
 * Shares and streak facts for one plan.
 *
 * A filed plan reads its own position: its streak once linked, its typed legs
 * while awaiting import (`planShares`). Otherwise a position opened from scratch
 * reads `POSITION_CLOSED` until its trades arrive, and the notifier pushes a
 * spurious change when they do. A plan with no position, or whose position has
 * lost its trades, reads the pool as plans always have.
 */
export function holdingFacts(rule: ExitRuleRecord, context: HoldingContext): HoldingFacts {
  const filed = rule.journalId ? context.filed.get(rule.journalId) : undefined
  if (filed?.resolution.kind === 'FOUND') {
    const { streak } = filed.resolution
    return {
      ...planShares(streak, []),
      currentStreakEntryDate: streak.entryDate,
      priorCloseDate: streak.priorCloseDate,
    }
  }
  if (filed?.resolution.kind === 'UNLINKED') {
    return { ...planShares(null, filed.typed), currentStreakEntryDate: null, priorCloseDate: null }
  }
  const streak = streakFor(context.streaks, rule.symbol, rule.accountType)
  return {
    sharesRemaining: context.heldBy.get(poolKey(rule.symbol, rule.accountType)) ?? new Decimal(0),
    sharesSold: streak?.sharesSold ?? new Decimal(0),
    currentStreakEntryDate: streak?.entryDate ?? null,
    priorCloseDate: streak?.priorCloseDate ?? null,
  }
}

/**
 * Resolves one plan's current facts and runs `assess()` — the "what is this
 * position's recommendation right now" step every caller needs, identically.
 * `position` is returned alongside `result` because `sharesRemaining` is a
 * caller-visible fact (shown on the screen, sized into `unrealizedTotal`), not
 * just an internal input to `assess()`.
 */
export function evaluateExitRule(
  rule: ExitRuleRecord,
  context: HoldingContext,
  bars: FeedBar[],
  settings: ExitSettings,
  now: Date,
): { position: ExitRulePosition; result: ExitAssessment } {
  const position = buildExitRulePosition(rule, holdingFacts(rule, context))
  const result = assess(position, bars, settings, todayFor(calendarFor(rule.assetClass), now))
  return { position, result }
}

const currencyFor = (assetClass: AssetClass): 'JPY' | 'USD' => (assetClass === 'US_EQUITY' ? 'USD' : 'JPY')

/** Per-share prices. Two places is enough for both currencies, and exact for both. */
const price = (value: Decimal | null): string | null => value?.toFixed(2) ?? null
const shares = (value: Decimal): string => value.toFixed()

/**
 * One plan as the screens draw it. `Decimal` values cross the wire as exact
 * strings, and the suggested action arrives as finished prose from
 * `lib/exit/rules.ts`, so the UI never has to reason about which branch of the
 * framework a position is in.
 */
export interface ExitRuleRow {
  id: string
  symbol: string
  name: string
  assetClass: AssetClass
  accountType: AccountType
  currency: 'JPY' | 'USD'

  entryDate: string
  entryPrice: string
  totalShares: string
  sharesRemaining: string
  supportLevel: string
  entryAtr: string | null
  lotSize: number
  /** After the per-position override is resolved against the global default. */
  trailingMethod: TrailingMethod
  trailingMethodOverride: TrailingMethod | null
  note: string | null

  initialStop: string
  riskPerShare: string
  target1: string
  partialExitShares: string
  target1Hit: boolean
  target1HitDate: string | null
  partialTaken: boolean
  highestClose: string | null
  trailingStop: string | null
  trailingActive: boolean
  currentStop: string

  currentPrice: string | null
  lastBarDate: string | null
  rsi14: string | null
  macdHist: string | null
  atr14: string | null

  daysHeld: number
  tradingDaysHeld: number
  timeStopFlag: boolean
  stale: boolean
  staleTradingDays: number
  /** True when no entry-date bar existed and support alone set the stop. */
  stopFromSupportOnly: boolean

  unrealizedPerShare: string | null
  unrealizedTotal: string | null

  actionKind: ExitActionKind
  actionMessage: string
  actionSeverity: 'urgent' | 'attention' | 'neutral'
}

export function exitRuleRow(
  rule: ExitRuleRecord,
  { position, result }: { position: ExitRulePosition; result: ExitAssessment },
): ExitRuleRow {
  return {
    id: rule.id,
    symbol: rule.symbol,
    name: rule.name,
    assetClass: rule.assetClass,
    accountType: rule.accountType,
    currency: currencyFor(rule.assetClass),

    entryDate: rule.entryDate,
    entryPrice: rule.entryPrice.toFixed(2),
    totalShares: shares(rule.totalShares),
    sharesRemaining: shares(position.sharesRemaining),
    supportLevel: rule.supportLevel.toFixed(2),
    entryAtr: price(rule.entryAtr),
    lotSize: rule.lotSize,
    trailingMethod: result.trailingMethod,
    trailingMethodOverride: rule.trailingMethod,
    note: rule.note,

    initialStop: result.initialStop.toFixed(2),
    riskPerShare: result.riskPerShare.toFixed(2),
    target1: result.target1.toFixed(2),
    partialExitShares: shares(result.partialExitShares),
    target1Hit: result.target1Hit,
    target1HitDate: result.target1HitDate,
    partialTaken: result.partialTaken,
    highestClose: price(result.highestClose),
    trailingStop: price(result.trailingStop),
    trailingActive: result.trailingActive,
    currentStop: result.currentStop.toFixed(2),

    currentPrice: price(result.latestBar?.close ?? null),
    lastBarDate: result.latestBar?.tradingDay ?? null,
    rsi14: result.latestBar?.rsi14.toFixed(1) ?? null,
    macdHist: result.latestBar?.macdHist.toFixed(4) ?? null,
    atr14: price(result.latestBar?.atr14 ?? null),

    daysHeld: result.daysHeld,
    tradingDaysHeld: result.tradingDaysHeld,
    timeStopFlag: result.timeStopFlag,
    stale: result.stale,
    staleTradingDays: result.staleTradingDays,
    stopFromSupportOnly: result.stopFromSupportOnly,

    unrealizedPerShare: price(result.unrealizedPerShare),
    unrealizedTotal:
      result.unrealizedPerShare === null
        ? null
        // Two places, like every other per-share figure: rounding to whole
        // units here discarded the cents on every US position.
        : result.unrealizedPerShare.mul(position.sharesRemaining).toFixed(2),

    actionKind: result.action.kind,
    actionMessage: result.action.message,
    actionSeverity: result.action.severity,
  }
}
