/**
 * A position's score: entry, exit, risk and result, 1–10 each.
 *
 * Never stored — recomputed on every read, so changing a curve here rescores
 * every position at once and nothing goes stale. The money going in is
 * `Decimal`; only the dimensionless ratios a curve reads are numbers.
 */
import Decimal from 'decimal.js'
import { ZERO } from '../domain/types'

/** Piecewise-linear through `points` (x ascending), flat beyond either end. */
export function curve(points: readonly (readonly [number, number])[], x: number): number {
  const first = points[0]!
  const last = points[points.length - 1]!
  if (x <= first[0]) return first[1]
  if (x >= last[0]) return last[1]
  for (let index = 1; index < points.length; index++) {
    const [x1, y1] = points[index]!
    const [x0, y0] = points[index - 1]!
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
  }
  return last[1]
}

/** Loss at the initial stop, % of equity → score. */
const LOSS_AT_STOP = [
  [0.5, 10],
  [1, 9],
  [2, 6],
  [3, 3],
  [5, 1],
] as const

/** Position cost, % of equity → score. */
const POSITION_COST = [
  [10, 10],
  [20, 8],
  [30, 6],
  [50, 3],
  [75, 1],
] as const

const R_RESULT = [
  [-2, 1],
  [-1, 3],
  [0, 5],
  [1, 7],
  [2, 9],
  [3, 10],
] as const

/** Used instead of R when there is no stop. */
const RETURN_RESULT = [
  [-10, 1],
  [-5, 3],
  [0, 5],
  [5, 7],
  [10, 9],
  [15, 10],
] as const

/**
 * A side's legs' 1–10 ratings, weighted by quantity.
 *
 * Null when no leg is rated. `complete` is false while any leg is still
 * unrated, which makes the overall score provisional.
 */
export function ratedLegs(
  legs: readonly { rating: number | null; quantity: Decimal }[],
): { score: number | null; complete: boolean } {
  const rated = legs.filter((leg) => leg.rating !== null)
  const weight = rated.reduce((sum, leg) => sum.add(leg.quantity), ZERO)
  if (rated.length === 0 || weight.lte(0)) return { score: null, complete: false }
  const score = rated
    .reduce((sum, leg) => sum.add(leg.quantity.mul(leg.rating!)), ZERO)
    .div(weight)
    .toNumber()
  return { score, complete: rated.length === legs.length }
}

export interface RiskInput {
  entryPrice: Decimal
  /** The plan's initial stop, live or static. Null when there is none. */
  stop: Decimal | null
  /** Units as the trade was sized — later top-ups do not rescore it. */
  shares: Decimal
  /** In the same currency as the prices. The position's locked account size. */
  equity: Decimal | null
  override: number | null
}

/**
 * How well the trade was sized: 70% the loss at the initial stop as a share of
 * equity, 30% the position's cost as a share of equity. A manual override
 * replaces it. Null without a stop or an account size.
 */
export function riskScore(input: RiskInput): number | null {
  if (input.override !== null) return input.override
  if (input.stop === null || input.equity === null || input.equity.lte(0)) return null
  const pct = (amount: Decimal) => amount.div(input.equity!).mul(100).toNumber()
  const loss = pct(Decimal.max(ZERO, input.entryPrice.sub(input.stop)).mul(input.shares))
  const cost = pct(input.entryPrice.mul(input.shares))
  return 0.7 * curve(LOSS_AT_STOP, loss) + 0.3 * curve(POSITION_COST, cost)
}

/**
 * Realized ÷ (risk per share × units closed). Null without a positive risk.
 *
 * `realizedNative` is net of both commissions and free of FX, so a JP R and a
 * US R compare like for like — which leaves a US R slightly below what its
 * displayed dollar figure implies, by the sell commission.
 */
export function rMultiple(realizedNative: Decimal, riskPerShare: Decimal | null, unitsClosed: Decimal): Decimal | null {
  if (riskPerShare === null || riskPerShare.lte(0) || unitsClosed.lte(0)) return null
  return realizedNative.div(riskPerShare.mul(unitsClosed))
}

/** The result on the closed units: by R when there is one, else by return. */
export function resultScore(r: Decimal | null, returnPct: Decimal | null): number | null {
  if (r !== null) return curve(R_RESULT, r.toNumber())
  if (returnPct !== null) return curve(RETURN_RESULT, returnPct.mul(100).toNumber())
  return null
}

export interface ScoreParts {
  entry: number | null
  exit: number | null
  risk: number | null
  result: number | null
}

export interface Score extends ScoreParts {
  overall: number | null
  /** A part is missing or a leg unrated, or the position is still open. */
  provisional: boolean
}

/**
 * Entry, exit, risk and result at 25% each, so process outweighs outcome three
 * to one. A missing part is dropped and the rest reweighted.
 */
export function overallScore(parts: ScoreParts, opts: { open: boolean; complete: boolean }): Score {
  const present = [parts.entry, parts.exit, parts.risk, parts.result].filter(
    (part): part is number => part !== null,
  )
  const overall = present.length === 0 ? null : present.reduce((sum, part) => sum + part, 0) / present.length
  return {
    ...parts,
    overall,
    provisional: opts.open || !opts.complete || present.length < 4,
  }
}
