/**
 * An exit plan's levels, before there is a plan.
 *
 * The dialog's live preview and a static plan — paper positions and past trades
 * — both come through here, so what the owner previews is what gets stored. The
 * arithmetic is the framework's own `initialStopFor` and `target1For`, not a copy
 * of them: a static plan is the same stop and target a live one would have had.
 */
import Decimal from 'decimal.js'
import { initialStopFor, target1For } from '../exit/rules'
import { riskScore } from './score'
import type { ExtraTarget } from './types'
import { extraTargetsProblem } from './validate'

export interface PlanLevelsInput {
  entryPrice: string
  shares: string
  supportLevel: string
  stopMultiple: string
  targetMultiple: string
  /** A manual Target 1; null for `entry + multiple × R`. */
  target1Override: string | null
  extraTargets: ExtraTarget[]
  /** In the position's own currency. */
  accountEquity: string | null
}

export interface PlanLevels {
  stop: Decimal
  /** True when no entry-date bar exists yet, so support alone set the stop. */
  fromSupportOnly: boolean
  riskPerShare: Decimal
  target1: Decimal
  /** Target 1 in R, whether computed or typed. */
  plannedR: Decimal
  riskAmount: Decimal
  /** Of the account, 0–1; null without an account size. */
  riskPct: Decimal | null
  sizePct: Decimal | null
  riskRating: number | null
}

function positive(value: string, label: string): Decimal | string {
  try {
    const parsed = new Decimal(value)
    return parsed.isFinite() && parsed.gt(0) ? parsed : `${label} must be above zero.`
  } catch {
    return `${label} must be a number.`
  }
}

/** The levels, or what is wrong with the input. `entryAtr` is the entry date's, if a bar has arrived. */
export function planLevels(input: PlanLevelsInput, entryAtr: Decimal | null): PlanLevels | string {
  const entryPrice = positive(input.entryPrice, 'Entry price')
  if (typeof entryPrice === 'string') return entryPrice
  const shares = positive(input.shares, 'Shares')
  if (typeof shares === 'string') return shares
  const supportLevel = positive(input.supportLevel, 'Support')
  if (typeof supportLevel === 'string') return supportLevel
  const entryStopAtrMultiple = positive(input.stopMultiple, 'The stop multiple')
  if (typeof entryStopAtrMultiple === 'string') return entryStopAtrMultiple
  const entryTargetMultiple = positive(input.targetMultiple, 'The target multiple')
  if (typeof entryTargetMultiple === 'string') return entryTargetMultiple
  const target1Override = input.target1Override === null ? null : positive(input.target1Override, 'Target 1')
  if (typeof target1Override === 'string') return target1Override
  const equity = input.accountEquity === null ? null : positive(input.accountEquity, 'Account size')
  if (typeof equity === 'string') return equity

  // At or above entry, R is zero or negative and Target 1 falls at or below the
  // entry price: the whole framework inverts.
  if (supportLevel.gte(entryPrice)) return 'Support must sit below the entry price.'
  if (target1Override?.lte(entryPrice)) return 'Target 1 must sit above the entry price.'
  const targetsProblem = extraTargetsProblem(input.extraTargets)
  if (targetsProblem) return targetsProblem

  const { stop, fromSupportOnly } = initialStopFor({ entryPrice, entryAtr, entryStopAtrMultiple, supportLevel })
  const riskPerShare = entryPrice.sub(stop)
  const target1 = target1For({ entryPrice, entryTargetMultiple, target1Override }, riskPerShare)
  const riskAmount = riskPerShare.mul(shares)
  return {
    stop,
    fromSupportOnly,
    riskPerShare,
    target1,
    plannedR: target1.sub(entryPrice).div(riskPerShare),
    riskAmount,
    riskPct: equity ? riskAmount.div(equity) : null,
    sizePct: equity ? entryPrice.mul(shares).div(equity) : null,
    riskRating: riskScore({ entryPrice, stop, shares, equity, override: null }),
  }
}
