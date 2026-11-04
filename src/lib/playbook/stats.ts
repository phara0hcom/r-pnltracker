/**
 * How a setup performs, over its closed positions.
 *
 * Real and paper are reported separately — a setup used both ways shows two
 * cards — and past trades count as real. Average R covers only the positions
 * that have one, and says how many that is.
 */
import type Decimal from 'decimal.js'
import { ZERO } from '../domain/types'
import type { JournalKind, PositionStatus } from './types'

const JOURNAL_KINDS: readonly JournalKind[] = ['REAL', 'PAPER']

export interface ScoredPosition {
  id: string
  kind: JournalKind
  status: PositionStatus
  /** Yen for a real position; native for paper. A win is above zero. */
  result: Decimal | null
  r: Decimal | null
  overall: number | null
}

export interface SetupStats {
  closed: number
  wins: number
  /** wins ÷ closed; null with nothing closed. */
  winRate: number | null
  averageR: Decimal | null
  /** How many positions `averageR` covers. */
  withR: number
  averageScore: number | null
  withScore: number
}

function statsOf(positions: readonly ScoredPosition[]): SetupStats {
  const closed = positions.filter((position) => position.status === 'CLOSED')
  const wins = closed.filter((position) => position.result?.gt(0) === true).length
  const rs = closed.flatMap((position) => (position.r === null ? [] : [position.r]))
  const scores = closed.flatMap((position) => (position.overall === null ? [] : [position.overall]))
  return {
    closed: closed.length,
    wins,
    winRate: closed.length === 0 ? null : wins / closed.length,
    averageR: rs.length === 0 ? null : rs.reduce((sum, r) => sum.add(r), ZERO).div(rs.length),
    withR: rs.length,
    averageScore: scores.length === 0 ? null : scores.reduce((sum, score) => sum + score, 0) / scores.length,
    withScore: scores.length,
  }
}

export function setupStats(positions: readonly ScoredPosition[]): Record<JournalKind, SetupStats> {
  return {
    REAL: statsOf(positions.filter((position) => position.kind === 'REAL')),
    PAPER: statsOf(positions.filter((position) => position.kind === 'PAPER')),
  }
}

/**
 * The kinds a setup has been used as, real first: one card each. Any position
 * counts, open ones too — a setup in use on paper is not an unused real one.
 */
export function kindsUsed(positions: readonly Pick<ScoredPosition, 'kind'>[]): JournalKind[] {
  return JOURNAL_KINDS.filter((kind) => positions.some((position) => position.kind === kind))
}

export type RankBy = 'SCORE' | 'R'

/** Below this many ranked positions, one list — two lists of five would share trades. */
const SPLIT_AT = 10
const SHOWN = 5

export type Ranking<P> = { best: P[]; worst: P[] } | { single: P[] }

/**
 * The best and worst closed positions, by overall score or by R.
 *
 * Positions without the figure ranked by are left out. With fewer than ten,
 * one ranked list (`single`) instead of a best five and a worst five.
 */
export function rankBestWorst<P extends ScoredPosition>(
  positions: readonly P[],
  by: RankBy,
): Ranking<P> {
  const value = (position: P): number | null =>
    by === 'R' ? (position.r?.toNumber() ?? null) : position.overall
  const ranked = positions
    .filter((position) => position.status === 'CLOSED' && value(position) !== null)
    .sort((left, right) => value(right)! - value(left)!)
  if (ranked.length < SPLIT_AT) return { single: ranked }
  return { best: ranked.slice(0, SHOWN), worst: ranked.slice(-SHOWN).reverse() }
}

const RANKED_BY: readonly RankBy[] = ['SCORE', 'R']

/**
 * Every ranking a setup's page can show, so its toggles need no second request.
 *
 * Per kind, because a paper win beside a real one would read as the same evidence.
 */
export function rankingsByKind<P extends ScoredPosition>(
  positions: readonly P[],
): Record<JournalKind, Record<RankBy, Ranking<P>>> {
  const of = (kind: JournalKind) => {
    const mine = positions.filter((position) => position.kind === kind)
    const [score, r] = RANKED_BY.map((by) => rankBestWorst(mine, by))
    return { SCORE: score!, R: r! }
  }
  return { REAL: of('REAL'), PAPER: of('PAPER') }
}
