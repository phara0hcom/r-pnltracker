/**
 * Playbook server functions: the playbooks, the reviews filed under them, and
 * capturing the charts a review is judged on.
 *
 * A REAL review's result is the engine's, read through `engineFor` like every
 * other screen, so a review can never disagree with Trades or Tax about what a
 * close made. Its legs' dates, prices and sizes are re-read from their trades
 * on every load, so correcting a trade corrects the review.
 */
import { createServerFn } from '@tanstack/react-start'
import Decimal from 'decimal.js'
import { z } from 'zod'
import { fetchCandles } from './candleSources'
import { engineFor } from './engine'
import { authed } from './middleware'
import { storedIntervals } from '~/db/candles.service'
import {
  createReview,
  deleteChart,
  deleteReview,
  chartsForReview,
  getReview,
  legWithReview,
  listPlaybooks,
  listReviews,
  reviewedTradeIds,
  saveChart,
  savePlaybook,
  saveReview,
  setPlaybookArchived,
  type LegRecord,
  type ReviewRecord,
} from '~/db/playbook.service'
import type { TradeRecord } from '~/db/trades.service'
import type { AccountType, AssetClass, Currency } from '~/lib/domain/types'
import { webhookSecretUsable } from '~/lib/exit/webhook'
import {
  candleTicker,
  fillInstant,
  normalizeInterval,
  placeFill,
  zoneOf,
  type Placement,
} from '~/lib/playbook/candles'
import { reviewFigures, type ComponentKey, type ReviewFigures } from '~/lib/playbook/score'
import { playbookStats } from '~/lib/playbook/stats'
import {
  RATING_MAX,
  RATING_MIN,
  type Candle,
  type CandleSource,
  type LegKind,
  type ReviewKind,
} from '~/lib/playbook/types'
import type { EngineResult } from '~/lib/pnl/engine'

// ── Shapes the screens render ───────────────────────────────────────────────

export interface PlaybookStatsView {
  reviews: number
  closed: number
  winRate: number | null
  /** Mean R per closed trade with a stop — the play's expectancy. */
  avgR: string | null
  avgScore: number | null
}

export interface PlaybookView {
  id: string
  name: string
  description: string
  criteria: string[]
  archived: boolean
  real: PlaybookStatsView
  paper: PlaybookStatsView
}

export interface ReviewRow {
  id: string
  playbookId: string | null
  kind: ReviewKind
  symbol: string
  name: string
  currency: Currency
  accountType: AccountType | null
  firstDate: string | null
  lastDate: string | null
  open: boolean
  pnl: string | null
  returnPct: number | null
  rMultiple: string | null
  entryRating: number | null
  exitRating: number | null
  riskRating: number | null
  overall: number | null
  provisional: boolean
  mistakes: string[]
}

export interface PlaybookScreen {
  playbooks: PlaybookView[]
  reviews: ReviewRow[]
  /** Unreviewed trades by pool, for starting a review from them. */
  pools: CandidatePool[]
}

export interface CandidateTrade {
  id: string
  kind: LegKind
  date: string
  price: string
  quantity: string
}

export interface CandidatePool {
  symbol: string
  name: string
  accountType: AccountType
  currency: Currency
  trades: CandidateTrade[]
}

export interface ChartMarker {
  legId: string
  kind: LegKind
  placement: Placement
}

export interface ChartView {
  id: string
  legId: string
  interval: string
  source: CandleSource
  capturedAt: string
  bars: Candle[]
  markers: ChartMarker[]
}

export interface LegView {
  id: string
  kind: LegKind
  tradeId: string | null
  /** Linked to a trade that has since been deleted — the stored copy is shown. */
  tradeMissing: boolean
  date: string
  time: string | null
  price: string
  quantity: string
  fee: string
  rating: number | null
  explanation: string
  charts: ChartView[]
}

export interface ReviewFiguresView {
  avgEntry: string | null
  avgExit: string | null
  entryQuantity: string
  exitQuantity: string
  open: boolean
  pnl: string | null
  returnPct: number | null
  riskPerUnit: string | null
  riskAmount: string | null
  riskPct: number | null
  sizePct: number | null
  rMultiple: string | null
  plannedR: string | null
  entryRating: number | null
  exitRating: number | null
  riskRatingAuto: number | null
  riskRating: number | null
  outcomeRating: number | null
  overall: number | null
  provisional: boolean
  components: { key: ComponentKey; score: number; weight: number }[]
}

export interface ReviewDetail {
  id: string
  kind: ReviewKind
  playbookId: string | null
  symbol: string
  name: string
  assetClass: AssetClass
  currency: Currency
  accountType: AccountType | null
  stopPrice: string | null
  targetPrice: string | null
  accountEquity: string | null
  riskRatingOverride: number | null
  criteriaMet: string[]
  mistakes: string[]
  lessons: string
  legs: LegView[]
  figures: ReviewFiguresView
  /** Trades of this pool in no review yet, to add as legs. */
  candidates: CandidateTrade[]
  playbooks: { id: string; name: string; criteria: string[]; archived: boolean }[]
  /** Every mistake tag used on any review, for the tag input to suggest. */
  knownMistakes: string[]
  /** `syminfo.ticker` the alert must send for this symbol; null for a fund. */
  tvTicker: string | null
  /** Timeframes the alert has delivered for it. */
  tvIntervals: { interval: string; bars: number; latest: string }[]
  webhookConfigured: boolean
}

// ── Helpers (handler-only; nothing else is exported) ────────────────────────

/** Prices to a tick past either market's: whole yen and a tenth, cents and a hundredth. */
const priceText = (value: Decimal, currency: Currency): string =>
  value.toDecimalPlaces(currency === 'JPY' ? 1 : 4).toFixed()

const amountText = (value: Decimal, currency: Currency): string =>
  currency === 'JPY' ? value.toFixed(0) : value.toFixed(2)

const sideKind = (side: string): LegKind =>
  side === 'SELL' || side === 'REDEEM' ? 'EXIT' : 'ENTRY'

/** A linked leg as its trade now stands — or as stored, if the trade is gone. */
function resolveLeg(
  leg: LegRecord,
  byId: Map<string, TradeRecord>,
): LegRecord & { tradeMissing: boolean } {
  if (!leg.tradeId) return { ...leg, tradeMissing: false }
  const record = byId.get(leg.tradeId)
  if (!record) return { ...leg, tradeMissing: true }
  const { trade } = record
  return {
    ...leg,
    date: trade.tradeDate,
    price: trade.unitPrice,
    quantity: trade.quantity,
    fee: trade.fee.add(trade.feeTax).add(trade.otherCost),
    tradeMissing: false,
  }
}

interface Resolved {
  review: ReviewRecord
  legs: (LegRecord & { tradeMissing: boolean })[]
  figures: ReviewFigures
}

function resolveReview(
  review: ReviewRecord,
  byId: Map<string, TradeRecord>,
  realizedByTrade: Map<string, Decimal>,
): Resolved {
  const legs = review.legs.map((leg) => resolveLeg(leg, byId))
  const realized =
    review.kind === 'REAL'
      ? legs
          .filter((leg) => leg.kind === 'EXIT' && leg.tradeId)
          .reduce((sum, leg) => sum.add(realizedByTrade.get(leg.tradeId!) ?? 0), new Decimal(0))
      : null
  const figures = reviewFigures({
    kind: review.kind,
    legs,
    stopPrice: review.stopPrice,
    targetPrice: review.targetPrice,
    accountEquity: review.accountEquity,
    riskRatingOverride: review.riskRatingOverride,
    realizedNative: realized,
  })
  return { review, legs, figures }
}

/** Trade id → its close's realized result, native currency, fees in. */
function realizedByTradeId(records: TradeRecord[], engine: EngineResult): Map<string, Decimal> {
  const idOf = new Map(records.map((record) => [record.trade, record.id]))
  const out = new Map<string, Decimal>()
  for (const close of engine.realized) {
    const id = idOf.get(close.trade)
    if (id) out.set(id, (out.get(id) ?? new Decimal(0)).add(close.realizedNative))
  }
  return out
}

function statsView(rows: Resolved[]): PlaybookStatsView {
  const stats = playbookStats(
    rows.map(({ review, figures }) => ({
      kind: review.kind,
      open: figures.open,
      pnl: figures.pnl,
      rMultiple: figures.rMultiple,
      overall: figures.score.overall,
    })),
  )
  return {
    reviews: stats.reviews,
    closed: stats.closed,
    winRate: stats.winRate,
    avgR: stats.avgR?.toFixed(2) ?? null,
    avgScore: stats.avgScore,
  }
}

function figuresView(figures: ReviewFigures, currency: Currency): ReviewFiguresView {
  const price = (value: Decimal | null) => (value === null ? null : priceText(value, currency))
  const amount = (value: Decimal | null) => (value === null ? null : amountText(value, currency))
  return {
    avgEntry: price(figures.avgEntry),
    avgExit: price(figures.avgExit),
    entryQuantity: figures.entryQuantity.toFixed(),
    exitQuantity: figures.exitQuantity.toFixed(),
    open: figures.open,
    pnl: amount(figures.pnl),
    returnPct: figures.returnPct?.toNumber() ?? null,
    riskPerUnit: price(figures.riskPerUnit),
    riskAmount: amount(figures.riskAmount),
    riskPct: figures.riskPct?.toNumber() ?? null,
    sizePct: figures.sizePct?.toNumber() ?? null,
    rMultiple: figures.rMultiple?.toFixed(2) ?? null,
    plannedR: figures.plannedR?.toFixed(2) ?? null,
    entryRating: figures.entryRating,
    exitRating: figures.exitRating,
    riskRatingAuto: figures.riskRatingAuto,
    riskRating: figures.riskRating,
    outcomeRating: figures.outcomeRating,
    overall: figures.score.overall,
    provisional: figures.score.provisional,
    components: figures.score.components,
  }
}

/** Unreviewed trades, grouped by the pool a review would cover. */
function candidatePools(records: TradeRecord[], reviewed: Set<string>): CandidatePool[] {
  const pools = new Map<string, CandidatePool>()
  for (const { id, trade } of records) {
    // Funds have no chart to judge an entry on, and a 再投資 was never a decision.
    if (reviewed.has(id) || trade.assetClass === 'FUND' || trade.side === 'REINVEST') continue
    const key = `${trade.symbol}\0${trade.accountType}`
    const pool = pools.get(key) ?? {
      symbol: trade.symbol,
      name: trade.name,
      accountType: trade.accountType,
      currency: trade.currency,
      trades: [],
    }
    pool.trades.push({
      id,
      kind: sideKind(trade.side),
      date: trade.tradeDate,
      price: priceText(trade.unitPrice, trade.currency),
      quantity: trade.quantity.toFixed(),
    })
    pools.set(key, pool)
  }
  // Most recent activity first: the trade just closed is the one to review.
  return [...pools.values()]
    .map((pool) => ({ ...pool, trades: pool.trades.sort((a, b) => b.date.localeCompare(a.date)) }))
    .sort((a, b) => (b.trades[0]?.date ?? '').localeCompare(a.trades[0]?.date ?? ''))
}

// ── Screens ─────────────────────────────────────────────────────────────────

export const getPlaybookScreen = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(async ({ context }): Promise<PlaybookScreen> => {
    const [{ records, engine }, playbooks, reviews, reviewed] = await Promise.all([
      engineFor(context.userId),
      listPlaybooks(context.userId),
      listReviews(context.userId),
      reviewedTradeIds(context.userId),
    ])
    const byId = new Map(records.map((record) => [record.id, record]))
    const realized = realizedByTradeId(records, engine)
    const resolved = reviews.map((review) => resolveReview(review, byId, realized))

    const forPlaybook = (id: string | null, kind: ReviewKind) =>
      resolved.filter(({ review }) => review.playbookId === id && review.kind === kind)

    return {
      playbooks: playbooks.map((playbook) => ({
        ...playbook,
        real: statsView(forPlaybook(playbook.id, 'REAL')),
        paper: statsView(forPlaybook(playbook.id, 'PAPER')),
      })),
      reviews: resolved.map(({ review, legs, figures }) => {
        const dates = legs.map((leg) => leg.date).sort()
        return {
          id: review.id,
          playbookId: review.playbookId,
          kind: review.kind,
          symbol: review.symbol,
          name: review.name,
          currency: review.currency,
          accountType: review.accountType,
          firstDate: dates[0] ?? null,
          lastDate: dates[dates.length - 1] ?? null,
          open: figures.open,
          pnl: figures.pnl === null ? null : amountText(figures.pnl, review.currency),
          returnPct: figures.returnPct?.toNumber() ?? null,
          rMultiple: figures.rMultiple?.toFixed(2) ?? null,
          entryRating: figures.entryRating,
          exitRating: figures.exitRating,
          riskRating: figures.riskRating,
          overall: figures.score.overall,
          provisional: figures.score.provisional,
          mistakes: review.mistakes,
        }
      }),
      pools: candidatePools(records, reviewed),
    }
  })

export const getReviewDetail = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((data: { id: string }) => ({ id: z.string().min(1).parse(data.id) }))
  .handler(async ({ data, context }): Promise<ReviewDetail> => {
    const review = await getReview(context.userId, data.id)
    if (!review) throw new Error('Review not found')

    const tvTicker = candleTicker(review.symbol, review.assetClass)
    const [{ records, engine }, playbooks, charts, reviewed, everyReview, tvIntervals] =
      await Promise.all([
        engineFor(context.userId),
        listPlaybooks(context.userId),
        chartsForReview(context.userId, review.id),
        reviewedTradeIds(context.userId),
        listReviews(context.userId),
        tvTicker === null ? Promise.resolve([]) : storedIntervals(tvTicker),
      ])
    const byId = new Map(records.map((record) => [record.id, record]))
    const { legs, figures } = resolveReview(review, byId, realizedByTradeId(records, engine))
    const zone = zoneOf(review.assetClass)

    const chartViews = charts.map((chart): ChartView => ({
      id: chart.id,
      legId: chart.legId,
      interval: chart.interval,
      source: chart.source,
      capturedAt: chart.capturedAt.toISOString(),
      bars: chart.bars,
      // Every fill of the review on every chart, so an entry's chart shows the
      // exit too when it falls inside the window.
      markers: legs.flatMap((leg) => {
        const placement = placeFill(chart.bars, chart.interval, leg, zone)
        return placement ? [{ legId: leg.id, kind: leg.kind, placement }] : []
      }),
    }))

    const pool = candidatePools(records, reviewed).find(
      (candidate) =>
        candidate.symbol === review.symbol && candidate.accountType === review.accountType,
    )

    return {
      id: review.id,
      kind: review.kind,
      playbookId: review.playbookId,
      symbol: review.symbol,
      name: review.name,
      assetClass: review.assetClass,
      currency: review.currency,
      accountType: review.accountType,
      stopPrice: review.stopPrice === null ? null : priceText(review.stopPrice, review.currency),
      targetPrice:
        review.targetPrice === null ? null : priceText(review.targetPrice, review.currency),
      accountEquity:
        review.accountEquity === null ? null : amountText(review.accountEquity, review.currency),
      riskRatingOverride: review.riskRatingOverride,
      criteriaMet: review.criteriaMet,
      mistakes: review.mistakes,
      lessons: review.lessons,
      legs: legs.map((leg) => ({
        id: leg.id,
        kind: leg.kind,
        tradeId: leg.tradeId,
        tradeMissing: leg.tradeMissing,
        date: leg.date,
        time: leg.time,
        price: priceText(leg.price, review.currency),
        quantity: leg.quantity.toFixed(),
        fee: amountText(leg.fee, review.currency),
        rating: leg.rating,
        explanation: leg.explanation,
        charts: chartViews
          .filter((chart) => chart.legId === leg.id)
          .sort((a, b) => intervalOrder(a.interval) - intervalOrder(b.interval)),
      })),
      figures: figuresView(figures, review.currency),
      candidates: review.kind === 'REAL' ? (pool?.trades ?? []) : [],
      playbooks: playbooks.map(({ id, name, criteria, archived }) => ({
        id,
        name,
        criteria,
        archived,
      })),
      knownMistakes: [...new Set(everyReview.flatMap((other) => other.mistakes))].sort(),
      tvTicker,
      tvIntervals: tvIntervals.map((row) => ({ ...row, latest: row.latest.toISOString() })),
      webhookConfigured: webhookSecretUsable(process.env.TRADINGVIEW_WEBHOOK_SECRET),
    }
  })

/** Shortest timeframe first, so a leg's charts read zoomed-in to zoomed-out. */
const UNIT_RANK: Record<string, number> = { m: 0, h: 1, D: 2, W: 3, M: 4 }
function intervalOrder(interval: string): number {
  const match = /^(\d+)(\w)$/.exec(interval)
  return match ? (UNIT_RANK[match[2]!] ?? 9) * 10_000 + Number(match[1]) : 99_999
}

// ── Writes ──────────────────────────────────────────────────────────────────

/** A decimal ≥ 0 as text, or empty for "not set". */
const optionalDecimal = (label: string) =>
  z
    .string()
    .trim()
    .nullable()
    .transform((raw, ctx) => {
      if (raw === null || raw === '') return null
      try {
        const parsed = new Decimal(raw.replace(/,/g, ''))
        if (!parsed.isFinite() || parsed.lt(0)) throw new Error('negative')
        return parsed.toFixed()
      } catch {
        ctx.addIssue({ code: 'custom', message: `${label} must be a number` })
        return z.NEVER
      }
    })

const requiredDecimal = (label: string) =>
  optionalDecimal(label)
    .refine((value) => value !== null, `${label} is required`)
    .transform((value) => value)

const rating = z.number().int().min(RATING_MIN).max(RATING_MAX).nullable()
const tags = z.array(z.string().trim().min(1).max(60)).max(30)

const playbookSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1, 'name is required').max(80),
  description: z.string().trim().max(5000),
  criteria: z.array(z.string().trim().min(1).max(200)).max(30),
})

export const savePlaybookFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => playbookSchema.parse(data))
  .handler(async ({ data, context }) => ({
    ok: true as const,
    id: await savePlaybook(context.userId, data),
  }))

export const archivePlaybookFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: { id: string; archived: boolean }) => data)
  .handler(async ({ data, context }) => {
    await setPlaybookArchived(context.userId, data.id, data.archived)
    return { ok: true as const }
  })

const newReviewSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('REAL'),
    playbookId: z.string().min(1).nullable(),
    tradeIds: z.array(z.string().min(1)).min(1, 'pick at least one trade').max(50),
  }),
  z.object({
    kind: z.literal('PAPER'),
    playbookId: z.string().min(1).nullable(),
    symbol: z
      .string()
      .trim()
      .min(1, 'symbol is required')
      .max(128)
      .transform((s) => s.toUpperCase()),
    name: z.string().trim().max(200),
    assetClass: z.enum(['JP_EQUITY', 'US_EQUITY']),
  }),
])

export const createReviewFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => newReviewSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertPlaybook(context.userId, data.playbookId)
    const id =
      data.kind === 'REAL'
        ? await createReview(context.userId, {
            kind: 'REAL',
            playbookId: data.playbookId,
            tradeIds: data.tradeIds,
            // Taken from the trades by the service.
            symbol: '',
            name: '',
            assetClass: 'JP_EQUITY',
            currency: 'JPY',
            accountType: null,
          })
        : await createReview(context.userId, {
            kind: 'PAPER',
            playbookId: data.playbookId,
            symbol: data.symbol,
            name: data.name,
            assetClass: data.assetClass,
            currency: data.assetClass === 'US_EQUITY' ? 'USD' : 'JPY',
            accountType: null,
            tradeIds: [],
          })
    return { ok: true as const, id }
  })

async function assertPlaybook(userId: string, playbookId: string | null): Promise<void> {
  if (playbookId === null) return
  const playbooks = await listPlaybooks(userId)
  if (!playbooks.some((playbook) => playbook.id === playbookId))
    throw new Error('playbook not found')
}

const legSchema = z.object({
  id: z.string().min(1).optional(),
  kind: z.enum(['ENTRY', 'EXIT']),
  tradeId: z.string().min(1).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  time: z
    .string()
    .trim()
    .nullable()
    .transform((raw) => (raw === null || raw === '' ? null : raw))
    .refine((raw) => raw === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(raw), 'time must be HH:MM'),
  price: requiredDecimal('price'),
  quantity: requiredDecimal('quantity'),
  fee: optionalDecimal('fee').transform((value) => value ?? '0'),
  rating,
  explanation: z.string().trim().max(10_000),
})

const saveReviewSchema = z.object({
  id: z.string().min(1),
  playbookId: z.string().min(1).nullable(),
  stopPrice: optionalDecimal('stop'),
  targetPrice: optionalDecimal('target'),
  accountEquity: optionalDecimal('account size'),
  riskRatingOverride: rating,
  criteriaMet: tags,
  mistakes: tags,
  lessons: z.string().trim().max(10_000),
  legs: z.array(legSchema).max(50),
})

export const saveReviewFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => saveReviewSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertPlaybook(context.userId, data.playbookId)
    const { id, legs, ...header } = data
    await saveReview(context.userId, id, header, legs)
    return { ok: true as const }
  })

export const deleteReviewFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await deleteReview(context.userId, data.id)
    return { ok: true as const }
  })

const captureSchema = z.object({
  legId: z.string().min(1),
  interval: z.string().transform((raw, ctx) => {
    const interval = normalizeInterval(raw)
    if (interval === null) {
      ctx.addIssue({ code: 'custom', message: `not a timeframe: ${raw}` })
      return z.NEVER
    }
    return interval
  }),
  source: z.enum(['TRADINGVIEW', 'YAHOO']),
})

/**
 * Captures a leg's chart: the bars around its fill, frozen into the review.
 *
 * Returns the reason rather than throwing when a source has nothing — no
 * alert yet, or Yahoo past its reach — because that is advice, not a fault.
 */
export const captureChartFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => captureSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const found = await legWithReview(context.userId, data.legId)
    if (!found) return { ok: false, error: 'That entry or exit no longer exists.' }
    const { leg, review } = found

    const at = fillInstant(leg, zoneOf(review.assetClass))

    const fetched = await fetchCandles(
      data.source,
      review.symbol,
      review.assetClass,
      data.interval,
      at,
      at,
    )
    if (!fetched.ok) return fetched
    await saveChart(context.userId, leg.id, {
      interval: data.interval,
      source: data.source,
      bars: fetched.bars,
    })
    return { ok: true }
  })

export const deleteChartFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await deleteChart(context.userId, data.id)
    return { ok: true as const }
  })
