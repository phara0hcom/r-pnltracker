/**
 * A review's figures and its overall score.
 *
 * The score answers "was this a good trade?" in the sense a playbook needs —
 * would I take it again the same way — so it is weighted three to one towards
 * *process*: the entry, the exit, and the risk taken, each rated 1–10, against
 * one quarter for the result. Weighting by result alone teaches that a lucky
 * oversized gamble was the best trade of the month.
 *
 * Every component is on the same 1–10 scale so the weights mean what they say.
 * A component that cannot be known yet — no exit while the trade is open, no
 * stop to measure risk from — is left out and the rest are reweighted, and the
 * score says it is provisional rather than counting the gap as a zero.
 *
 * Money stays `Decimal` up to the ratios; ratings are plain numbers from there.
 */
import Decimal from 'decimal.js'
import { RATING_MAX, RATING_MIN, type LegKind, type ReviewKind } from './types'

export interface LegFigures {
  kind: LegKind
  price: Decimal
  quantity: Decimal
  fee: Decimal
  /** 1–10, or null when not rated yet. */
  rating: number | null
}

export interface ReviewInput {
  kind: ReviewKind
  legs: readonly LegFigures[]
  stopPrice: Decimal | null
  targetPrice: Decimal | null
  accountEquity: Decimal | null
  riskRatingOverride: number | null
  /**
   * A REAL review's realized result from the engine, native currency, summed
   * over its linked exits — fees in, and on the pool's moving average, so it is
   * the figure Rakuten and the tax screen show. Null on paper, where the legs
   * are all there is.
   */
  realizedNative: Decimal | null
}

export type ComponentKey = 'entry' | 'exit' | 'risk' | 'outcome'

export interface ScoreComponent {
  key: ComponentKey
  /** 1–10, one decimal. */
  score: number
  /** The share of the overall this component carried, after reweighting. */
  weight: number
}

export interface OverallScore {
  /** 1–10, one decimal; null when nothing at all is rated yet. */
  overall: number | null
  components: ScoreComponent[]
  /** True while a component is missing — open, unrated, or no stop. */
  provisional: boolean
}

export interface ReviewFigures {
  entryQuantity: Decimal
  exitQuantity: Decimal
  avgEntry: Decimal | null
  avgExit: Decimal | null
  /** Units still held: entries the exits have not closed. */
  open: boolean
  /** Realized on the closed units, native currency, after fees. */
  pnl: Decimal | null
  /** `pnl` over what the closed units cost. */
  returnPct: Decimal | null
  /** Entry − stop: what one share stood to lose. */
  riskPerUnit: Decimal | null
  /** One R in money: the whole entry's quantity times `riskPerUnit`. */
  riskAmount: Decimal | null
  /** `riskAmount` as a fraction of account equity. */
  riskPct: Decimal | null
  /** The entry's cost as a fraction of account equity. */
  sizePct: Decimal | null
  /** The result in R. */
  rMultiple: Decimal | null
  /** Target − entry over entry − stop: the reward the plan was taken for. */
  plannedR: Decimal | null
  entryRating: number | null
  exitRating: number | null
  /** From `riskPct` and `sizePct`; the override, when set, replaces it in the score. */
  riskRatingAuto: number | null
  riskRating: number | null
  outcomeRating: number | null
  score: OverallScore
}

/** Equal quarters before reweighting. Process — entry, exit, risk — is three of them. */
export const WEIGHTS: Record<ComponentKey, number> = {
  entry: 0.25,
  exit: 0.25,
  risk: 0.25,
  outcome: 0.25,
}

const clampRating = (value: number): number =>
  Math.min(RATING_MAX, Math.max(RATING_MIN, Math.round(value * 10) / 10))

/**
 * Linear between the given points, flat beyond the ends.
 *
 * The curves below are a judgement written as data, so each can be read and
 * argued with at a glance instead of being buried in arithmetic.
 */
export function piecewise(x: number, points: readonly (readonly [number, number])[]): number {
  const first = points[0]!
  const last = points[points.length - 1]!
  if (x <= first[0]) return first[1]
  if (x >= last[0]) return last[1]
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!
    const [x0, y0] = points[i - 1]!
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
  }
  return last[1]
}

/**
 * Percent of the account lost if the stop is hit → rating.
 *
 * The swing-trading rule of thumb is 1% a trade, 2% at the outside: under
 * half a percent is as careful as it gets, three percent means six losses in
 * a row cost a fifth of the account.
 */
export const RISK_CURVE = [
  [0.5, 10],
  [1, 9],
  [2, 6],
  [3, 3],
  [5, 1],
] as const

/**
 * Position cost as percent of the account → rating.
 *
 * Separate from the risk curve because a tight stop can make an enormous
 * position look careful: a gap through the stop is what a stop does not cover.
 */
export const SIZE_CURVE = [
  [10, 10],
  [20, 8],
  [30, 6],
  [50, 3],
  [75, 1],
] as const

/** Result in R → rating. Losing exactly one R on a stop that held is a 3, not a failure. */
export const R_CURVE = [
  [-2, 1],
  [-1, 3],
  [0, 5],
  [1, 7],
  [2, 9],
  [3, 10],
] as const

/** With no stop to measure R against, the return itself, in percent. */
export const RETURN_CURVE = [
  [-10, 1],
  [-5, 3],
  [0, 5],
  [5, 7],
  [10, 9],
  [15, 10],
] as const

/** How much of the risk rating is the stop's percent rather than the position's size. */
const RISK_SHARE = 0.7

export function riskRatingFor(riskPct: Decimal | null, sizePct: Decimal | null): number | null {
  const risk = riskPct === null ? null : piecewise(riskPct.mul(100).toNumber(), RISK_CURVE)
  const size = sizePct === null ? null : piecewise(sizePct.mul(100).toNumber(), SIZE_CURVE)
  if (risk !== null && size !== null)
    return clampRating(risk * RISK_SHARE + size * (1 - RISK_SHARE))
  if (risk !== null) return clampRating(risk)
  if (size !== null) return clampRating(size)
  return null
}

export function outcomeRatingFor(
  rMultiple: Decimal | null,
  returnPct: Decimal | null,
): number | null {
  if (rMultiple !== null) return clampRating(piecewise(rMultiple.toNumber(), R_CURVE))
  if (returnPct !== null) return clampRating(piecewise(returnPct.mul(100).toNumber(), RETURN_CURVE))
  return null
}

/** Quantity-weighted, so a small add rated 3 does not count as much as the main entry rated 8. */
function weightedRating(legs: readonly LegFigures[]): number | null {
  const rated = legs.filter((leg) => leg.rating !== null && leg.quantity.gt(0))
  if (rated.length === 0) return null
  const total = rated.reduce((sum, leg) => sum.add(leg.quantity), new Decimal(0))
  const weighted = rated.reduce(
    (sum, leg) => sum.add(leg.quantity.mul(leg.rating!)),
    new Decimal(0),
  )
  return clampRating(weighted.div(total).toNumber())
}

function average(legs: readonly LegFigures[]): {
  quantity: Decimal
  price: Decimal | null
  fees: Decimal
} {
  const quantity = legs.reduce((sum, leg) => sum.add(leg.quantity), new Decimal(0))
  const fees = legs.reduce((sum, leg) => sum.add(leg.fee), new Decimal(0))
  if (quantity.lte(0)) return { quantity, price: null, fees }
  const value = legs.reduce((sum, leg) => sum.add(leg.quantity.mul(leg.price)), new Decimal(0))
  return { quantity, price: value.div(quantity), fees }
}

export function combineScore(ratings: Partial<Record<ComponentKey, number | null>>): OverallScore {
  const present = (Object.keys(WEIGHTS) as ComponentKey[]).filter(
    (key) => ratings[key] !== null && ratings[key] !== undefined,
  )
  if (present.length === 0) return { overall: null, components: [], provisional: true }

  const totalWeight = present.reduce((sum, key) => sum + WEIGHTS[key], 0)
  const components = present.map((key) => ({
    key,
    score: ratings[key]!,
    weight: WEIGHTS[key] / totalWeight,
  }))
  const overall = components.reduce((sum, part) => sum + part.score * part.weight, 0)
  return {
    overall: clampRating(overall),
    components,
    provisional: present.length < Object.keys(WEIGHTS).length,
  }
}

export function reviewFigures(input: ReviewInput): ReviewFigures {
  const entries = input.legs.filter((leg) => leg.kind === 'ENTRY')
  const exits = input.legs.filter((leg) => leg.kind === 'EXIT')
  const entry = average(entries)
  const exit = average(exits)
  const open = entry.quantity.gt(exit.quantity)
  const closed = Decimal.min(entry.quantity, exit.quantity)

  // What the closed units cost, their share of the entry fees included.
  const closedCost =
    entry.price === null || closed.lte(0)
      ? null
      : entry.price.mul(closed).add(entry.fees.mul(closed).div(entry.quantity))

  let pnl: Decimal | null = null
  if (input.kind === 'REAL') {
    pnl = exits.length > 0 ? input.realizedNative : null
  } else if (closedCost !== null && exit.price !== null) {
    pnl = exit.price.mul(closed).sub(exit.fees).sub(closedCost)
  }
  const returnPct = pnl !== null && closedCost?.gt(0) ? pnl.div(closedCost) : null

  const riskPerUnit =
    entry.price !== null && input.stopPrice !== null && entry.price.gt(input.stopPrice)
      ? entry.price.sub(input.stopPrice)
      : null
  const riskAmount = riskPerUnit === null ? null : riskPerUnit.mul(entry.quantity)
  const equity = input.accountEquity?.gt(0) ? input.accountEquity : null
  const riskPct = riskAmount !== null && equity !== null ? riskAmount.div(equity) : null
  const sizePct =
    entry.price !== null && equity !== null ? entry.price.mul(entry.quantity).div(equity) : null

  // R is measured on the units closed, so half a position out at +2R reads +2R
  // on that half rather than +1R on the whole.
  const rMultiple =
    pnl !== null && riskPerUnit !== null && closed.gt(0) ? pnl.div(riskPerUnit.mul(closed)) : null
  const plannedR =
    riskPerUnit !== null && entry.price !== null && input.targetPrice !== null
      ? input.targetPrice.sub(entry.price).div(riskPerUnit)
      : null

  const entryRating = weightedRating(entries)
  const exitRating = weightedRating(exits)
  const riskRatingAuto = riskRatingFor(riskPct, sizePct)
  const riskRating = input.riskRatingOverride ?? riskRatingAuto
  const outcomeRating = outcomeRatingFor(rMultiple, returnPct)

  const score = combineScore({
    entry: entryRating,
    exit: exitRating,
    risk: riskRating,
    outcome: outcomeRating,
  })

  return {
    entryQuantity: entry.quantity,
    exitQuantity: exit.quantity,
    avgEntry: entry.price,
    avgExit: exit.price,
    open,
    pnl,
    returnPct,
    riskPerUnit,
    riskAmount,
    riskPct,
    sizePct,
    rMultiple,
    plannedR,
    entryRating,
    exitRating,
    riskRatingAuto,
    riskRating,
    outcomeRating,
    // An open trade's score is provisional even when every part has a number:
    // the exit still to come can change two of them.
    score: open ? { ...score, provisional: true } : score,
  }
}
