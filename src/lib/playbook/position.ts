/**
 * One position as the screens read it, derived from its stored anchor and
 * annotations, the holding streaks and the engine's closes.
 *
 * Everything here is recomputed on each read and nothing is stored back: which
 * trades belong, the status, the result, R and the score. See `streaks.ts` for
 * why membership cannot be a stored list.
 */
import Decimal from 'decimal.js'
import { ZERO, type AccountType, type AssetClass, type NormalizedTrade } from '../domain/types'
import type { RealizedEvent } from '../pnl/engine'
import { usdGain } from '../pnl/usdResult'
import { paperResult, paperStatus, type PaperLeg } from './paper'
import { overallScore, ratedLegs, resultScore, riskScore, rMultiple, type Score } from './score'
import {
  attachAnnotations,
  isOpen,
  legsOf,
  realStatus,
  resolvePosition,
  type HoldingStreak,
  type Resolution,
  type StreakTrade,
} from './streaks'
import type { JournalKind, LegSide, PositionStatus } from './types'

/** An annotation or typed-in leg, as stored. */
export interface StoredLeg {
  id: string
  side: LegSide
  date: string
  firstTradeId: string | null
  executedAt: Date | null
  price: Decimal | null
  quantity: Decimal | null
  fee: Decimal | null
  rating: number | null
  note: string | null
}

/** What a position stores that decides how it reads. */
export interface StoredPosition {
  id: string
  kind: JournalKind
  symbol: string
  assetClass: AssetClass
  accountType: AccountType | null
  entryDate: string
  anchorTradeId: string | null
  archivedAt: Date | null
  stopPrice: Decimal | null
  target1Price: Decimal | null
  accountEquity: Decimal | null
  riskRatingOverride: number | null
  legs: StoredLeg[]
}

/** A plan's entry facts, live or archived. A static plan's come from the position. */
export interface PlanBasis {
  entryPrice: Decimal
  stop: Decimal
  target1: Decimal
  /** As the trade was sized. */
  shares: Decimal
}

export interface DerivedLeg {
  side: LegSide
  date: string
  /** Null on a typed leg. */
  firstTradeId: string | null
  /** The stored row: a typed leg, or an annotation once one exists. */
  annotationId: string | null
  quantity: Decimal
  averagePrice: Decimal
  fills: number
  /** The fills' shared time, the first one's if they differ, or the typed time. */
  executedAt: Date | null
  /** Every fill has a time, so a time set on the leg would write to none of them. */
  allTimed: boolean
  rating: number | null
  note: string
  /** The note still reads from the fills' memos rather than from the leg. */
  noteFromMemos: boolean
  /** The fills' ids; empty on a typed leg. */
  tradeIds: string[]
}

export interface PositionResult {
  /** Dollars for a US close, as every other screen shows one; else yen. */
  shown: Decimal
  /** Null for paper, which has no yen figure. */
  jpy: Decimal | null
  /** Net of both commissions and free of FX: what R reads. */
  native: Decimal
  unitsClosed: Decimal
  /** 0–1 of the cost of the units closed. */
  returnPct: Decimal | null
}

export interface DerivedPosition {
  status: PositionStatus
  resolution: Resolution | null
  streak: HoldingStreak | null
  legs: DerivedLeg[]
  /** Annotations no leg claims. Listed, never dropped. */
  unattached: StoredLeg[]
  openDate: string
  closeDate: string | null
  entryPrice: Decimal | null
  sharesHeld: Decimal
  /** Null until something has closed. */
  result: PositionResult | null
  stop: Decimal | null
  target1: Decimal | null
  riskPerShare: Decimal | null
  r: Decimal | null
  plannedR: Decimal | null
  riskAmount: Decimal | null
  riskPct: Decimal | null
  sizePct: Decimal | null
  score: Score
}

/**
 * The note a leg shows: what the owner wrote on it, else its fills' memos.
 *
 * Nothing is copied across, so `trades.memo` stays as it was and shows again if
 * the position is deleted. An emptied note is stored as `''` rather than null,
 * so deleting one does not bring the memos back.
 */
export function legNote(
  stored: string | null,
  fills: readonly Pick<StreakTrade, 'memo'>[],
): { note: string; fromMemos: boolean } {
  if (stored !== null) return { note: stored, fromMemos: false }
  const memos = [...new Set(fills.flatMap((fill) => (fill.memo ? [fill.memo] : [])))]
  return { note: memos.join(' · '), fromMemos: memos.length > 0 }
}

function derivedLegs(streak: HoldingStreak, stored: readonly StoredLeg[]): { legs: DerivedLeg[]; unattached: StoredLeg[] } {
  const legs = legsOf(streak)
  const { byLeg, unattached } = attachAnnotations(legs, stored)
  return {
    unattached,
    legs: legs.map((leg) => {
      const annotation = byLeg.get(leg.firstTradeId)
      const { note, fromMemos } = legNote(annotation?.note ?? null, leg.fills)
      return {
        side: leg.side,
        date: leg.date,
        firstTradeId: leg.firstTradeId,
        annotationId: annotation?.id ?? null,
        quantity: leg.quantity,
        averagePrice: leg.averagePrice,
        fills: leg.fills.length,
        executedAt: leg.fills.find((fill) => fill.executedAt)?.executedAt ?? null,
        allTimed: leg.fills.every((fill) => fill.executedAt),
        rating: annotation?.rating ?? null,
        note,
        noteFromMemos: fromMemos,
        tradeIds: leg.fills.map((fill) => fill.id),
      }
    }),
  }
}

const typedLeg = (leg: StoredLeg): DerivedLeg => ({
  side: leg.side,
  date: leg.date,
  firstTradeId: null,
  annotationId: leg.id,
  quantity: leg.quantity ?? ZERO,
  averagePrice: leg.price ?? ZERO,
  fills: 1,
  executedAt: leg.executedAt,
  allTimed: leg.executedAt !== null,
  rating: leg.rating,
  note: leg.note ?? '',
  noteFromMemos: false,
  tradeIds: [],
})

const toPaperLeg = (leg: StoredLeg): PaperLeg => ({
  side: leg.side,
  date: leg.date,
  executedAt: leg.executedAt,
  price: leg.price ?? ZERO,
  quantity: leg.quantity ?? ZERO,
  fee: leg.fee ?? ZERO,
})

/** The engine's closes for a streak's sells, found by reference. */
function streakResult(
  streak: HoldingStreak,
  realizedBy: ReadonlyMap<NormalizedTrade, RealizedEvent>,
): PositionResult | null {
  const closes = streak.trades.flatMap((record) => {
    const close = realizedBy.get(record.trade)
    return close ? [close] : []
  })
  if (closes.length === 0) return null
  const sum = (read: (close: RealizedEvent) => Decimal) => closes.reduce((total, close) => total.add(read(close)), ZERO)
  const us = closes[0]?.assetClass === 'US_EQUITY'
  const jpy = sum((close) => close.realizedJpy)
  const shown = us ? sum(usdGain) : jpy
  const cost = us ? sum((close) => close.costNative) : sum((close) => close.costJpy)
  return {
    shown,
    jpy,
    native: sum((close) => close.realizedNative),
    unitsClosed: sum((close) => close.quantity),
    returnPct: cost.gt(0) ? shown.div(cost) : null,
  }
}

export function derivePosition(
  position: StoredPosition,
  streaks: readonly HoldingStreak[],
  realizedBy: ReadonlyMap<NormalizedTrade, RealizedEvent>,
  plan: PlanBasis | null,
): DerivedPosition {
  const typed = position.legs.filter((leg) => leg.price !== null && leg.quantity !== null)
  const paper = paperResult(typed.map(toPaperLeg))
  const resolution =
    position.kind === 'REAL' && position.accountType
      ? resolvePosition({ ...position, accountType: position.accountType }, streaks)
      : null
  const streak = resolution?.kind === 'FOUND' ? resolution.streak : null

  const status: PositionStatus = resolution ? realStatus(resolution) : paperStatus(paper)
  const linked = streak ? derivedLegs(streak, position.legs) : null
  // A position that lost its streak has no legs to attach to: every annotation
  // is listed as unattached until it is linked again.
  const missing = resolution?.kind === 'MISSING'
  const legs = linked?.legs ?? (missing ? [] : typed.map(typedLeg))
  const unattached = linked?.unattached ?? (missing ? position.legs : [])

  const result: PositionResult | null = streak
    ? streakResult(streak, realizedBy)
    : position.kind === 'PAPER' && paper.sharesSold.gt(0)
      ? {
          shown: paper.realized,
          jpy: null,
          native: paper.realized,
          unitsClosed: paper.sharesSold,
          returnPct: paper.returnPct,
        }
      : null

  const entryPrice = plan?.entryPrice ?? streak?.entryPrice ?? paper.entryPrice
  const stop = plan?.stop ?? position.stopPrice
  const target1 = plan?.target1 ?? position.target1Price
  const riskPerShare = entryPrice && stop ? entryPrice.sub(stop) : null
  const r = result && rMultiple(result.native, riskPerShare, result.unitsClosed)

  // As sized: the plan's shares, else the first entry leg. A later top-up does
  // not rescore the trade.
  const entryLegs = legs.filter((leg) => leg.side === 'ENTRY')
  const exitLegs = legs.filter((leg) => leg.side === 'EXIT')
  const shares = plan?.shares ?? entryLegs[0]?.quantity ?? null
  const equity = position.accountEquity
  const riskAmount = riskPerShare && shares ? Decimal.max(ZERO, riskPerShare).mul(shares) : null
  const entry = ratedLegs(entryLegs)
  const exit = ratedLegs(exitLegs)

  const score = overallScore(
    {
      entry: entry.score,
      exit: exit.score,
      risk:
        entryPrice && shares
          ? riskScore({ entryPrice, stop, shares, equity, override: position.riskRatingOverride })
          : position.riskRatingOverride,
      result: result ? resultScore(r, result.returnPct) : null,
    },
    { open: status !== 'CLOSED', complete: entry.complete && exit.complete },
  )

  return {
    status,
    resolution,
    streak,
    legs,
    unattached,
    openDate: streak?.entryDate ?? position.entryDate,
    closeDate: streak ? streak.closeDate : lastExitDate(status, exitLegs),
    entryPrice,
    sharesHeld: streak?.sharesHeld ?? paper.sharesHeld,
    result,
    stop,
    target1,
    riskPerShare,
    r,
    plannedR:
      riskPerShare?.gt(0) && entryPrice && target1 ? target1.sub(entryPrice).div(riskPerShare) : null,
    riskAmount,
    riskPct: riskAmount && equity?.gt(0) ? riskAmount.div(equity) : null,
    sizePct: entryPrice && shares && equity?.gt(0) ? entryPrice.mul(shares).div(equity) : null,
    score,
  }
}

const lastExitDate = (status: PositionStatus, exits: readonly DerivedLeg[]): string | null =>
  status === 'CLOSED' ? (exits.map((leg) => leg.date).sort().at(-1) ?? null) : null

/** Whether a position's streak is what makes a plan over it finished. */
export const streakClosed = (streak: HoldingStreak | null): boolean => streak !== null && !isOpen(streak)

/** A trade's place in a filed position: where its note really lives. */
export interface SharedNote {
  journalId: string
  side: LegSide
  date: string
  firstTradeId: string
  annotationId: string | null
  /** As the leg shows it; empty when there is none. */
  note: string
}

/**
 * Which trades belong to a live real position, and the note each now shows.
 *
 * The Calendar and the Trades screen read a trade's memo through this, so one
 * note reads the same from everywhere. An archived position gives its trades'
 * memos back to them, as a deleted one does.
 */
export function sharedNotes(
  positions: readonly StoredPosition[],
  streaks: readonly HoldingStreak[],
): Map<string, SharedNote> {
  const out = new Map<string, SharedNote>()
  for (const position of positions) {
    if (position.kind !== 'REAL' || position.archivedAt || !position.accountType) continue
    const resolved = resolvePosition({ ...position, accountType: position.accountType }, streaks)
    if (resolved.kind !== 'FOUND') continue
    for (const leg of derivedLegs(resolved.streak, position.legs).legs) {
      for (const tradeId of leg.tradeIds) {
        out.set(tradeId, {
          journalId: position.id,
          side: leg.side,
          date: leg.date,
          firstTradeId: leg.firstTradeId!,
          annotationId: leg.annotationId,
          note: leg.note,
        })
      }
    }
  }
  return out
}
