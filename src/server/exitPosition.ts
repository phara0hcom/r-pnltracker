/**
 * Builds the pure `assess()` input from a stored plan plus the live facts that
 * change independently of it, and the two small steps around that both
 * current call sites need.
 *
 * Shared by `server/exit.ts` (the screen) and `server/exitNotifications.ts`
 * (the webhook-triggered notifier) so the rationale behind each field — why
 * `sharesSold` rather than `sharesRemaining < totalShares` says a partial was
 * taken, why a later streak entry date means the plan is superseded — is
 * written once rather than drifting between two call sites. Only `import
 * type` reaches `~/db/exit.service`, so this module carries no server-only
 * code into anything that imports it — see `docs/server-only-modules.md`.
 */
import Decimal from 'decimal.js'
import type { ExitRuleRecord } from '~/db/exit.service'
import type { AccountType } from '~/lib/domain/types'
import { calendarFor, todayFor } from '~/lib/exit/calendar'
import type { EntryStreak } from '~/lib/exit/entry'
import { streakFor } from '~/lib/exit/entry'
import { assess } from '~/lib/exit/rules'
import type { ExitAssessment, ExitRulePosition, ExitSettings, FeedBar } from '~/lib/exit/types'
import { poolKey } from '~/lib/pnl/engine'

export function buildExitRulePosition(
  rule: ExitRuleRecord,
  sharesRemaining: Decimal,
  streak: EntryStreak | null,
): ExitRulePosition {
  return {
    symbol: rule.symbol,
    name: rule.name,
    assetClass: rule.assetClass,
    accountType: rule.accountType,
    entryDate: rule.entryDate,
    entryPrice: rule.entryPrice,
    totalShares: rule.totalShares,
    sharesRemaining,
    sharesSold: streak?.sharesSold ?? new Decimal(0),
    supportLevel: rule.supportLevel,
    currentStreakEntryDate: streak?.entryDate ?? null,
    entryAtr: rule.entryAtr,
    entryStopAtrMultiple: rule.entryStopAtrMultiple,
    entryTargetMultiple: rule.entryTargetMultiple,
    lotSize: rule.lotSize,
    trailingMethod: rule.trailingMethod,
  }
}

/** `(symbol × accountType) → quantity held`, the shape both call sites read `sharesRemaining` from. */
export function positionsByPool(
  positions: { symbol: string; accountType: AccountType; quantity: Decimal }[],
): Map<string, Decimal> {
  return new Map(
    positions.map((position) => [poolKey(position.symbol, position.accountType), position.quantity]),
  )
}

/**
 * Resolves one plan's current facts and runs `assess()` — the "what is this
 * position's recommendation right now" step both the screen and the notifier
 * need, identically. `position` is returned alongside `result` because
 * `sharesRemaining` is a caller-visible fact (shown on the screen, sized into
 * `unrealizedTotal`), not just an internal input to `assess()`.
 */
export function evaluateExitRule(
  rule: ExitRuleRecord,
  heldBy: Map<string, Decimal>,
  streaks: Map<string, EntryStreak>,
  bars: FeedBar[],
  settings: ExitSettings,
  now: Date,
): { position: ExitRulePosition; result: ExitAssessment } {
  const remaining = heldBy.get(poolKey(rule.symbol, rule.accountType)) ?? new Decimal(0)
  const streak = streakFor(streaks, rule.symbol, rule.accountType)
  const position = buildExitRulePosition(rule, remaining, streak)
  const result = assess(position, bars, settings, todayFor(calendarFor(rule.assetClass), now))
  return { position, result }
}
