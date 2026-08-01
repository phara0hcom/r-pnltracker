/**
 * NISA quota engine — annual frames and the ¥18M lifetime cap.
 *
 * Four rules drive this, each a place a naive sum gets it wrong:
 *
 * 1. The ¥18M lifetime cap is measured at 簿価 (acquisition cost), not market
 *    value. Gains never consume quota.
 * 2. Selling frees lifetime quota equal to the *acquisition cost* of the units
 *    sold — but only from January of the FOLLOWING year. Never within the same
 *    year as the sale.
 * 3. Annual frames never restore. ¥1.2M / ¥2.4M are use-it-or-lose-it,
 *    independent of the lifetime pool.
 * 4. 旧NISA is a separate, closed system. Its holdings do not consume any part
 *    of the ¥18M.
 *
 * Verified against 三菱UFJ銀行 / 楽天証券 guidance.
 */
import Decimal from 'decimal.js'
import { OPENING_SIDES, ZERO, type AccountType, type NormalizedTrade } from '../domain/types'
import type { PositionState, RealizedEvent } from '../pnl/engine'

/** つみたて投資枠, per calendar year. */
export const ANNUAL_TSUMITATE_LIMIT = new Decimal(1_200_000)
/** 成長投資枠, per calendar year. */
export const ANNUAL_GROWTH_LIMIT = new Decimal(2_400_000)
/** Combined annual ceiling. */
export const ANNUAL_TOTAL_LIMIT = ANNUAL_TSUMITATE_LIMIT.add(ANNUAL_GROWTH_LIMIT)
/** 非課税保有限度額 — lifetime, at book value. */
export const LIFETIME_LIMIT = new Decimal(18_000_000)
/** Of the ¥18M, at most this may sit in 成長投資枠. */
export const LIFETIME_GROWTH_SUBCAP = new Decimal(12_000_000)

/** The two new-NISA frames. 旧NISA is deliberately not one of them. */
export type NisaFrame = 'NISA_GROWTH' | 'NISA_TSUMITATE'

export const isNewNisa = (a: AccountType): a is NisaFrame =>
  a === 'NISA_GROWTH' || a === 'NISA_TSUMITATE'

export interface AnnualFrameUsage {
  year: number
  frame: NisaFrame
  limit: Decimal
  used: Decimal
  remaining: Decimal
  /** 0–1; >= 1 means the frame is exhausted. */
  utilization: number
  isMaxed: boolean
}

export interface LifetimeUsage {
  /** Book value currently occupying the ¥18M pool. */
  used: Decimal
  limit: Decimal
  remaining: Decimal
  /** Portion of `used` held in 成長投資枠, against its ¥12M sub-cap. */
  growthUsed: Decimal
  growthSubCap: Decimal
  growthRemaining: Decimal
  /** Acquisition cost of units sold this year — returns to the pool next January. */
  pendingRestoration: Decimal
  /** The January in which `pendingRestoration` lands. */
  restorationDate: string
  utilization: number
}

export interface NisaReport {
  asOfYear: number
  lifetime: LifetimeUsage
  /** Every year that has activity, ascending. */
  annual: AnnualFrameUsage[]
  /** Cumulative book value contributed per year, for the lifetime chart. */
  contributionsByYear: { year: number; growth: Decimal; tsumitate: Decimal }[]
}

const yearOf = (iso: string): number => Number(iso.slice(0, 4))

/**
 * Quota is consumed on 約定日 (trade date), not settlement.
 *
 * Confirmed by the data: totalling 2026 成長投資枠 purchases on a trade-date
 * basis gives exactly ¥2,400,000 — the annual cap to the yen. A settlement-date
 * basis would not land on the cap, and filling a frame exactly is deliberate.
 */
const quotaDate = (t: NormalizedTrade): string => t.tradeDate

/**
 * Acquisition cost that a purchase charges against the frame.
 *
 * `REINVEST` counts: a distribution reinvested inside NISA is a fresh purchase
 * and consumes annual quota — a well-known trap. None of the current data does
 * this inside new NISA (all reinvestments sit in 特定 or 旧NISA), but the rule
 * is implemented so it stays correct if it ever happens.
 */
function acquisitionCost(t: NormalizedTrade): Decimal {
  return t.netAmountJpy
}

/** Per-year, per-frame consumption. Annual frames never restore. */
export function annualUsage(trades: NormalizedTrade[]): AnnualFrameUsage[] {
  const acc = new Map<string, Decimal>()
  for (const t of trades) {
    if (!isNewNisa(t.accountType)) continue
    if (!OPENING_SIDES.includes(t.side)) continue
    const k = `${yearOf(quotaDate(t))}|${t.accountType}`
    acc.set(k, (acc.get(k) ?? ZERO).add(acquisitionCost(t)))
  }

  const out: AnnualFrameUsage[] = []
  for (const [k, used] of acc) {
    const [yearStr, frame] = k.split('|') as [string, NisaFrame]
    const limit = frame === 'NISA_GROWTH' ? ANNUAL_GROWTH_LIMIT : ANNUAL_TSUMITATE_LIMIT
    out.push({
      year: Number(yearStr),
      frame,
      limit,
      used,
      remaining: Decimal.max(ZERO, limit.sub(used)),
      utilization: used.div(limit).toNumber(),
      isMaxed: used.gte(limit),
    })
  }
  return out.sort((a, b) => a.year - b.year || a.frame.localeCompare(b.frame))
}

/**
 * Lifetime pool at book value.
 *
 * Purchases add their acquisition cost. Disposals give it back — but only once
 * the following January has arrived, so a sale made this year is still
 * occupying the pool right now.
 */
export function lifetimeUsage(
  trades: NormalizedTrade[],
  realized: RealizedEvent[],
  asOfYear: number,
): LifetimeUsage {
  let acquired = ZERO
  let growthAcquired = ZERO

  for (const t of trades) {
    if (!isNewNisa(t.accountType)) continue
    if (!OPENING_SIDES.includes(t.side)) continue
    if (yearOf(quotaDate(t)) > asOfYear) continue
    const cost = acquisitionCost(t)
    acquired = acquired.add(cost)
    if (t.accountType === 'NISA_GROWTH') growthAcquired = growthAcquired.add(cost)
  }

  let restored = ZERO
  let growthRestored = ZERO
  let pending = ZERO

  for (const e of realized) {
    if (!isNewNisa(e.accountType)) continue
    const soldYear = yearOf(e.tradeDate)
    if (soldYear > asOfYear) continue
    if (soldYear < asOfYear) {
      // Sold in an earlier year — the quota came back that January.
      restored = restored.add(e.costJpy)
      if (e.accountType === 'NISA_GROWTH') growthRestored = growthRestored.add(e.costJpy)
    } else {
      // Sold this year — still occupying the pool until next January.
      pending = pending.add(e.costJpy)
    }
  }

  const used = Decimal.max(ZERO, acquired.sub(restored))
  const growthUsed = Decimal.max(ZERO, growthAcquired.sub(growthRestored))

  return {
    used,
    limit: LIFETIME_LIMIT,
    remaining: Decimal.max(ZERO, LIFETIME_LIMIT.sub(used)),
    growthUsed,
    growthSubCap: LIFETIME_GROWTH_SUBCAP,
    growthRemaining: Decimal.max(ZERO, LIFETIME_GROWTH_SUBCAP.sub(growthUsed)),
    pendingRestoration: pending,
    restorationDate: `${asOfYear + 1}-01`,
    utilization: used.div(LIFETIME_LIMIT).toNumber(),
  }
}

/** Book value contributed per year, split by frame — drives the lifetime chart. */
export function contributionsByYear(
  trades: NormalizedTrade[],
): { year: number; growth: Decimal; tsumitate: Decimal }[] {
  const acc = new Map<number, { growth: Decimal; tsumitate: Decimal }>()
  for (const t of trades) {
    if (!isNewNisa(t.accountType)) continue
    if (!OPENING_SIDES.includes(t.side)) continue
    const y = yearOf(quotaDate(t))
    const row = acc.get(y) ?? { growth: ZERO, tsumitate: ZERO }
    if (t.accountType === 'NISA_GROWTH') row.growth = row.growth.add(acquisitionCost(t))
    else row.tsumitate = row.tsumitate.add(acquisitionCost(t))
    acc.set(y, row)
  }
  return [...acc.entries()]
    .map(([year, v]) => ({ year, ...v }))
    .sort((a, b) => a.year - b.year)
}

export function buildNisaReport(
  trades: NormalizedTrade[],
  realized: RealizedEvent[],
  asOfYear: number,
): NisaReport {
  return {
    asOfYear,
    lifetime: lifetimeUsage(trades, realized, asOfYear),
    annual: annualUsage(trades),
    contributionsByYear: contributionsByYear(trades),
  }
}

/**
 * Remaining book value of 旧NISA holdings — reported separately so it stays
 * visible without ever counting against the ¥18M.
 *
 * Derived from the engine's open positions rather than by netting trades:
 * a sale's cash proceeds are not its acquisition cost, so subtracting proceeds
 * from purchases drives the figure negative as soon as anything is sold at a
 * gain. The engine already tracks the cost basis actually remaining.
 */
export function legacyNisaBookValue(positions: PositionState[]): Decimal {
  return positions
    .filter((p) => p.accountType === 'NISA_OLD')
    .reduce((acc, p) => acc.add(p.costBasisJpy), ZERO)
}
