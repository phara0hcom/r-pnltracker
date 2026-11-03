/**
 * What a Playbook position is: one holding streak of one pool.
 *
 * A streak runs from the buy that takes a pool off flat to the sell that
 * returns it to flat, or to today while units are still held. Membership,
 * status and result are derived from the trade history on every read — only
 * the *anchor* (the streak's first opening trade id) and the owner's
 * annotations are stored. A stored list of member trades would have to follow
 * every import restatement, settlement regrouping and manual edit, and would
 * drift; a derived one cannot.
 *
 * Because a streak starts and ends flat, the engine's moving-average result
 * over its sells is exactly that trade's result: no units from another swing
 * are averaged in.
 *
 * Pure, like the rest of `lib`.
 */
import Decimal from 'decimal.js'
import {
  CLOSING_SIDES,
  OPENING_SIDES,
  ZERO,
  type AccountType,
  type AssetClass,
  type NormalizedTrade,
} from '../domain/types'
import { poolKey, sortTradesForEngine } from '../pnl/engine'
import type { LegSide, PositionStatus } from './types'

/** A stored trade with the id the Playbook keys it by. */
export interface StreakTrade {
  id: string
  trade: NormalizedTrade
  /** When it filled, if the owner entered it. */
  executedAt?: Date | null
  /** The trade's own memo, read as its leg's note until the owner writes one. */
  memo?: string | null
}

export interface HoldingStreak {
  symbol: string
  accountType: AccountType
  /** The first opening trade's id — what a position stores to say which streak it is. */
  anchorId: string
  /** 約定日 of the buy that took the pool off flat. */
  entryDate: string
  /** 約定日 of the sell that returned it to flat; null while units are held. */
  closeDate: string | null
  /**
   * 約定日 of the sell that last left the pool flat before this streak, or null
   * when it never has been. See `EntryStreak.priorCloseDate`.
   */
  priorCloseDate: string | null
  /** Its trades in engine order — a hand-set day order included. */
  trades: StreakTrade[]
  /** Weighted average of the streak's buy prices, native currency. */
  entryPrice: Decimal
  sharesBought: Decimal
  sharesSold: Decimal
  /** Units still held; zero once closed. */
  sharesHeld: Decimal
}

/**
 * Every streak of every pool, open and closed, oldest first within a pool.
 *
 * Quantity is clamped at zero exactly as the engine clamps it: a close with
 * nothing held — a history that begins mid-position — belongs to no streak,
 * and a close larger than the holding ends the streak rather than taking the
 * pool negative, which would swallow the next buy.
 */
export function holdingStreaks(records: readonly StreakTrade[]): HoldingStreak[] {
  const byTrade = new Map(records.map((record) => [record.trade, record]))
  const pools = new Map<string, StreakTrade[]>()
  // Engine ordering, so a same-day round trip cannot look like it closed
  // before it opened, and a hand-set day order is honoured.
  for (const trade of sortTradesForEngine(records.map((record) => record.trade))) {
    const record = byTrade.get(trade)!
    const key = poolKey(trade.symbol, trade.accountType)
    const list = pools.get(key)
    if (list) list.push(record)
    else pools.set(key, [record])
  }

  const out: HoldingStreak[] = []
  for (const list of pools.values()) {
    let held = ZERO
    let lastFlatDate: string | null = null
    let current: HoldingStreak | null = null

    for (const record of list) {
      const { trade } = record
      if (OPENING_SIDES.includes(trade.side)) {
        if (current === null) {
          current = {
            symbol: trade.symbol,
            accountType: trade.accountType,
            anchorId: record.id,
            entryDate: trade.tradeDate,
            closeDate: null,
            priorCloseDate: lastFlatDate,
            trades: [],
            entryPrice: trade.unitPrice,
            sharesBought: ZERO,
            sharesSold: ZERO,
            sharesHeld: ZERO,
          }
          out.push(current)
        }
        const bought = current.sharesBought.add(trade.quantity)
        current.entryPrice = bought.gt(0)
          ? current.entryPrice.mul(current.sharesBought).add(trade.unitPrice.mul(trade.quantity)).div(bought)
          : current.entryPrice
        current.sharesBought = bought
        current.trades.push(record)
        held = held.add(trade.quantity)
        current.sharesHeld = held
        continue
      }

      if (!CLOSING_SIDES.includes(trade.side)) continue
      if (current === null) {
        // Nothing held: the history began mid-position. The engine skips it too.
        lastFlatDate = trade.tradeDate
        continue
      }
      current.trades.push(record)
      current.sharesSold = current.sharesSold.add(trade.quantity)
      held = Decimal.max(ZERO, held.sub(trade.quantity))
      current.sharesHeld = held
      // A partial sell — the Target 1 exit — leaves the same swing running.
      if (held.lte(0)) {
        current.closeDate = trade.tradeDate
        lastFlatDate = trade.tradeDate
        current = null
      }
    }
  }
  return out
}

export const isOpen = (streak: HoldingStreak): boolean => streak.closeDate === null

const addDays = (date: string, days: number): string => {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/** What a stored position knows about which streak it is. */
export interface PositionAnchor {
  symbol: string
  accountType: AccountType
  assetClass: AssetClass
  /** The streak's start as known when the position was filed — the fallback key. */
  entryDate: string
  anchorTradeId: string | null
}

export type Resolution =
  | { kind: 'UNLINKED' }
  | { kind: 'FOUND'; streak: HoldingStreak; via: 'ANCHOR' | 'FALLBACK' }
  | { kind: 'MISSING' }

/**
 * The streak a position is, by its anchor — or by its entry date when the
 * anchor trade is gone.
 *
 * A US restatement updates the row in place, so the anchor id survives
 * re-dating. Settlement regrouping can soft-delete it, and then the streak of
 * the same pool starting on the stored `entryDate` — or the day after, for a
 * US pool, which Rakuten re-dates by one — is the one. Anything else is
 * `MISSING`: the position offers to relink rather than guessing.
 */
export function resolvePosition(position: PositionAnchor, streaks: readonly HoldingStreak[]): Resolution {
  if (position.anchorTradeId === null) return { kind: 'UNLINKED' }
  const pool = streaks.filter(
    (streak) => streak.symbol === position.symbol && streak.accountType === position.accountType,
  )
  const byAnchor = pool.find((streak) => streak.trades.some((record) => record.id === position.anchorTradeId))
  if (byAnchor) return { kind: 'FOUND', streak: byAnchor, via: 'ANCHOR' }

  const dates = [position.entryDate]
  if (position.assetClass === 'US_EQUITY') dates.push(addDays(position.entryDate, 1))
  for (const date of dates) {
    const byDate = pool.find((streak) => streak.entryDate === date)
    if (byDate) return { kind: 'FOUND', streak: byDate, via: 'FALLBACK' }
  }
  return { kind: 'MISSING' }
}

/**
 * The streak an exit plan was made over — for a plan with no position yet, which
 * has only its dates to go on.
 *
 * The streak starting on the plan's entry date (or the day after, for a US pool,
 * as the anchor falls back); otherwise the one running across that date, since a
 * plan's entry date can be typed in anywhere inside the swing. Null when the pool
 * held nothing then.
 */
export function streakOfPlan(
  plan: Pick<PositionAnchor, 'symbol' | 'accountType' | 'assetClass' | 'entryDate'>,
  streaks: readonly HoldingStreak[],
): HoldingStreak | null {
  const pool = streaks.filter((streak) => streak.symbol === plan.symbol && streak.accountType === plan.accountType)
  const dates = plan.assetClass === 'US_EQUITY' ? [plan.entryDate, addDays(plan.entryDate, 1)] : [plan.entryDate]
  for (const date of dates) {
    const exact = pool.find((streak) => streak.entryDate === date)
    if (exact) return exact
  }
  return (
    pool.find(
      (streak) =>
        streak.entryDate <= plan.entryDate && (streak.closeDate === null || streak.closeDate >= plan.entryDate),
    ) ?? null
  )
}

/**
 * The date a plan should carry once linked to a streak: the streak's, so it does
 * not replay bars from a mistyped day or read as superseded by the streak just
 * chosen. Except a US streak one day later, which is Rakuten re-dating the fill on
 * settlement: a plan keeps the date it was made against (`docs/exit-rules.md`).
 */
export function linkedPlanDate(plan: Pick<PositionAnchor, 'assetClass' | 'entryDate'>, streakDate: string): string {
  return plan.assetClass === 'US_EQUITY' && streakDate === addDays(plan.entryDate, 1) ? plan.entryDate : streakDate
}

/** A real position's status. Paper positions use `paperStatus` in `paper.ts`. */
export function realStatus(resolution: Resolution): PositionStatus {
  switch (resolution.kind) {
    case 'UNLINKED':
      return 'AWAITING_IMPORT'
    case 'MISSING':
      return 'MISSING'
    case 'FOUND':
      return isOpen(resolution.streak) ? 'OPEN' : 'CLOSED'
  }
}

export interface Leg {
  side: LegSide
  date: string
  /** The first fill's id — what an annotation is keyed by. */
  firstTradeId: string
  fills: StreakTrade[]
  quantity: Decimal
  /** Quantity-weighted, native currency. */
  averagePrice: Decimal
}

/**
 * A streak's fills grouped into decisions: one leg per side and 約定日.
 *
 * One order filled as several executions is one leg, rated once. Two separate
 * decisions on the same side and day merge too — rare in swing trading, and
 * the price of not storing membership.
 */
export function legsOf(streak: HoldingStreak): Leg[] {
  const legs = new Map<string, Leg>()
  for (const record of streak.trades) {
    const side: LegSide = OPENING_SIDES.includes(record.trade.side) ? 'ENTRY' : 'EXIT'
    const key = `${side}\0${record.trade.tradeDate}`
    const leg = legs.get(key)
    if (!leg) {
      legs.set(key, {
        side,
        date: record.trade.tradeDate,
        firstTradeId: record.id,
        fills: [record],
        quantity: record.trade.quantity,
        averagePrice: record.trade.unitPrice,
      })
      continue
    }
    const quantity = leg.quantity.add(record.trade.quantity)
    leg.averagePrice = quantity.gt(0)
      ? leg.averagePrice.mul(leg.quantity).add(record.trade.unitPrice.mul(record.trade.quantity)).div(quantity)
      : leg.averagePrice
    leg.quantity = quantity
    leg.fills.push(record)
  }
  return [...legs.values()]
}

/** A stored annotation, keyed to its leg. */
export interface Annotation {
  id: string
  side: LegSide
  date: string
  firstTradeId: string | null
}

/**
 * Which annotation belongs to which leg, and which belong to none.
 *
 * By first fill id first; by `(side, date)` when that fill is gone, as the
 * anchor falls back. An annotation that matches no leg is returned as
 * unattached so the page can list it — the owner's notes are never dropped
 * silently.
 */
export function attachAnnotations<A extends Annotation>(
  legs: readonly Leg[],
  annotations: readonly A[],
): { byLeg: Map<string, A>; unattached: A[] } {
  const byLeg = new Map<string, A>()
  const rest: A[] = []
  for (const annotation of annotations) {
    const leg = legs.find((candidate) => candidate.firstTradeId === annotation.firstTradeId)
    if (leg && !byLeg.has(leg.firstTradeId)) byLeg.set(leg.firstTradeId, annotation)
    else rest.push(annotation)
  }
  const unattached: A[] = []
  for (const annotation of rest) {
    const leg = legs.find(
      (candidate) =>
        candidate.side === annotation.side &&
        candidate.date === annotation.date &&
        !byLeg.has(candidate.firstTradeId),
    )
    if (leg) byLeg.set(leg.firstTradeId, annotation)
    else unattached.push(annotation)
  }
  return { byLeg, unattached }
}

/**
 * Streaks a position awaiting import may be linked to.
 *
 * The same pool, starting no earlier than the day before `entryDate` —
 * Rakuten dates a US fill by its US day before settlement and the JST day
 * after — and not already what another position resolves to. Newest last.
 */
export function linkCandidates(
  position: Pick<PositionAnchor, 'symbol' | 'accountType' | 'entryDate'>,
  streaks: readonly HoldingStreak[],
  claimedAnchorIds: ReadonlySet<string>,
): HoldingStreak[] {
  const earliest = addDays(position.entryDate, -1)
  return streaks.filter(
    (streak) =>
      streak.symbol === position.symbol &&
      streak.accountType === position.accountType &&
      streak.entryDate >= earliest &&
      !claimedAnchorIds.has(streak.anchorId),
  )
}

/** A typed-in leg, as stored on a position awaiting import or a paper one. */
export interface TypedLeg {
  id: string
  side: LegSide
  quantity: Decimal | null
  executedAt: Date | null
}

/**
 * Typed legs paired with the derived legs they become on linking: by side,
 * then in order. Typed legs left over stay as unattached annotations.
 *
 * `times` lists the fills each typed time is written to — only those still
 * without one, so a time already entered on import wins.
 */
export function pairTypedLegs(
  typed: readonly TypedLeg[],
  legs: readonly Leg[],
): { pairs: { typedId: string; leg: Leg }[]; times: Map<string, Date> } {
  const pairs: { typedId: string; leg: Leg }[] = []
  const times = new Map<string, Date>()
  for (const side of ['ENTRY', 'EXIT'] as const) {
    const derived = legs.filter((leg) => leg.side === side)
    typed
      .filter((leg) => leg.side === side)
      .forEach((leg, index) => {
        const match = derived[index]
        if (!match) return
        pairs.push({ typedId: leg.id, leg: match })
        if (!leg.executedAt) return
        for (const fill of match.fills) {
          if (!fill.executedAt) times.set(fill.id, leg.executedAt)
        }
      })
  }
  return { pairs, times }
}

/**
 * Shares remaining and sold, as the exit plan is evaluated against them.
 *
 * Linked: from the position's own streak. Awaiting import: from the typed
 * legs — otherwise a position opened from scratch reads `POSITION_CLOSED`
 * until its trades arrive, and the notifier pushes a spurious change when
 * they do, the first evaluation having only seeded silently.
 */
export function planShares(
  streak: HoldingStreak | null,
  typed: readonly Pick<TypedLeg, 'side' | 'quantity'>[],
): { sharesRemaining: Decimal; sharesSold: Decimal } {
  if (streak) return { sharesRemaining: streak.sharesHeld, sharesSold: streak.sharesSold }
  const total = (side: LegSide) =>
    typed.filter((leg) => leg.side === side).reduce((sum, leg) => sum.add(leg.quantity ?? ZERO), ZERO)
  const sold = total('EXIT')
  return { sharesRemaining: Decimal.max(ZERO, total('ENTRY').sub(sold)), sharesSold: sold }
}
