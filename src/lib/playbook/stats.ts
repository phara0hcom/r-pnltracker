/**
 * How a playbook performs across its reviews — the reason to keep one.
 *
 * Only closed trades count towards the results: an open trade's P&L is the
 * part already taken, and averaging that in would flatter a play by its
 * winners' first partials. Paper trades are counted beside real ones, never
 * mixed into them, because a setup that only works on paper is the finding.
 */
import Decimal from 'decimal.js'
import type { ReviewKind } from './types'

export interface StatInput {
  kind: ReviewKind
  open: boolean
  pnl: Decimal | null
  rMultiple: Decimal | null
  overall: number | null
}

export interface PlaybookStats {
  reviews: number
  closed: number
  wins: number
  /** Over closed trades with a result; null with none. */
  winRate: number | null
  /** Mean R over closed trades that had a stop — the expectancy per trade, in R. */
  avgR: Decimal | null
  /** Mean overall score over every scored review, open ones included. */
  avgScore: number | null
}

export function playbookStats(reviews: readonly StatInput[]): PlaybookStats {
  const closed = reviews.filter((review) => !review.open && review.pnl !== null)
  const wins = closed.filter((review) => review.pnl!.gt(0)).length
  const withR = closed.filter((review) => review.rMultiple !== null)
  const scored = reviews.filter((review) => review.overall !== null)

  return {
    reviews: reviews.length,
    closed: closed.length,
    wins,
    winRate: closed.length === 0 ? null : wins / closed.length,
    avgR:
      withR.length === 0
        ? null
        : withR
            .reduce((sum, review) => sum.add(review.rMultiple!), new Decimal(0))
            .div(withR.length),
    avgScore:
      scored.length === 0
        ? null
        : Math.round(
            (scored.reduce((sum, review) => sum + review.overall!, 0) / scored.length) * 10,
          ) / 10,
  }
}
