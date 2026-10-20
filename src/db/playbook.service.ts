/**
 * Playbooks, trade reviews, their legs and captured charts.
 *
 * Every read and write is scoped by `userId`, including the child tables —
 * legs and charts carry it themselves so a forged id from another account
 * matches nothing instead of needing a join to be refused.
 */
import { randomUUID } from 'node:crypto'
import Decimal from 'decimal.js'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { idFor } from './mappers'
import { instruments, playbooks, reviewCharts, reviewLegs, tradeReviews, trades } from './schema'
import { db } from './index'
import type { AccountType, AssetClass, Currency } from '~/lib/domain/types'
import type { Candle, CandleSource, LegKind, ReviewKind } from '~/lib/playbook/types'

const newId = (kind: string) => idFor(kind, randomUUID())

/**
 * Postgres' unique-violation code — the one constraint a user can trip here by
 * hand. Drizzle wraps the driver's error in its own "Failed query", so the code
 * sits on `cause`.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let at: unknown = error; typeof at === 'object' && at !== null; at = (at as { cause?: unknown }).cause) {
    if ((at as { code?: unknown }).code === '23505') return true
  }
  return false
}

// ── Playbooks ───────────────────────────────────────────────────────────────

export interface PlaybookRecord {
  id: string
  name: string
  description: string
  criteria: string[]
  archived: boolean
}

export async function listPlaybooks(userId: string): Promise<PlaybookRecord[]> {
  const rows = await db
    .select()
    .from(playbooks)
    .where(eq(playbooks.userId, userId))
    .orderBy(asc(playbooks.name))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    criteria: row.criteria,
    archived: row.archivedAt !== null,
  }))
}

export interface PlaybookInput {
  id?: string
  name: string
  description: string
  criteria: string[]
}

export async function savePlaybook(userId: string, input: PlaybookInput): Promise<string> {
  try {
    if (input.id) {
      const updated = await db
        .update(playbooks)
        .set({
          name: input.name,
          description: input.description,
          criteria: input.criteria,
          updatedAt: new Date(),
        })
        .where(and(eq(playbooks.userId, userId), eq(playbooks.id, input.id)))
        .returning({ id: playbooks.id })
      if (updated.length === 0) throw new Error('playbook not found')
      return input.id
    }
    const id = newId('playbook')
    await db.insert(playbooks).values({
      id,
      userId,
      name: input.name,
      description: input.description,
      criteria: input.criteria,
    })
    return id
  } catch (error) {
    if (isUniqueViolation(error))
      throw new Error(`A playbook called “${input.name}” already exists.`)
    throw error
  }
}

/** Archived rather than deleted: its reviews keep pointing at it. */
export async function setPlaybookArchived(
  userId: string,
  id: string,
  archived: boolean,
): Promise<void> {
  await db
    .update(playbooks)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(playbooks.userId, userId), eq(playbooks.id, id)))
}

// ── Reviews ─────────────────────────────────────────────────────────────────

export interface ChartSummary {
  id: string
  interval: string
  source: CandleSource
  capturedAt: Date
}

export interface ChartRecord extends ChartSummary {
  legId: string
  bars: Candle[]
}

export interface LegRecord {
  id: string
  kind: LegKind
  tradeId: string | null
  date: string
  time: string | null
  price: Decimal
  quantity: Decimal
  fee: Decimal
  rating: number | null
  explanation: string
  charts: ChartSummary[]
}

export interface ReviewRecord {
  id: string
  playbookId: string | null
  kind: ReviewKind
  symbol: string
  name: string
  assetClass: AssetClass
  currency: Currency
  accountType: AccountType | null
  stopPrice: Decimal | null
  targetPrice: Decimal | null
  accountEquity: Decimal | null
  riskRatingOverride: number | null
  criteriaMet: string[]
  mistakes: string[]
  lessons: string
  createdAt: Date
  legs: LegRecord[]
}

const decimalOrNull = (value: string | null): Decimal | null =>
  value === null ? null : new Decimal(value)

/**
 * Every review with its legs and which charts each has — but not the charts'
 * bars, which are the bulk of the data and only one screen draws.
 */
export async function listReviews(userId: string, onlyId?: string): Promise<ReviewRecord[]> {
  const reviewRows = await db
    .select()
    .from(tradeReviews)
    .where(and(eq(tradeReviews.userId, userId), onlyId ? eq(tradeReviews.id, onlyId) : undefined))
    .orderBy(desc(tradeReviews.createdAt))
  if (reviewRows.length === 0) return []

  const ids = reviewRows.map((row) => row.id)
  const [legRows, chartRows] = await Promise.all([
    db
      .select()
      .from(reviewLegs)
      .where(and(eq(reviewLegs.userId, userId), inArray(reviewLegs.reviewId, ids)))
      .orderBy(asc(reviewLegs.position), asc(reviewLegs.date)),
    db
      .select({
        id: reviewCharts.id,
        legId: reviewCharts.legId,
        interval: reviewCharts.interval,
        source: reviewCharts.source,
        capturedAt: reviewCharts.capturedAt,
      })
      .from(reviewCharts)
      .innerJoin(reviewLegs, eq(reviewCharts.legId, reviewLegs.id))
      .where(and(eq(reviewCharts.userId, userId), inArray(reviewLegs.reviewId, ids))),
  ])

  const chartsByLeg = new Map<string, ChartSummary[]>()
  for (const chart of chartRows) {
    const list = chartsByLeg.get(chart.legId) ?? []
    list.push({
      id: chart.id,
      interval: chart.interval,
      source: chart.source,
      capturedAt: chart.capturedAt,
    })
    chartsByLeg.set(chart.legId, list)
  }

  const legsByReview = new Map<string, LegRecord[]>()
  for (const leg of legRows) {
    const list = legsByReview.get(leg.reviewId) ?? []
    list.push({
      id: leg.id,
      kind: leg.kind,
      tradeId: leg.tradeId,
      date: leg.date,
      time: leg.time,
      price: new Decimal(leg.price),
      quantity: new Decimal(leg.quantity),
      fee: new Decimal(leg.fee),
      rating: leg.rating,
      explanation: leg.explanation,
      charts: chartsByLeg.get(leg.id) ?? [],
    })
    legsByReview.set(leg.reviewId, list)
  }

  return reviewRows.map((row) => ({
    id: row.id,
    playbookId: row.playbookId,
    kind: row.kind,
    symbol: row.symbol,
    name: row.name,
    assetClass: row.assetClass,
    currency: row.currency,
    accountType: row.accountType,
    stopPrice: decimalOrNull(row.stopPrice),
    targetPrice: decimalOrNull(row.targetPrice),
    accountEquity: decimalOrNull(row.accountEquity),
    riskRatingOverride: row.riskRatingOverride,
    criteriaMet: row.criteriaMet,
    mistakes: row.mistakes,
    lessons: row.lessons,
    createdAt: row.createdAt,
    legs: legsByReview.get(row.id) ?? [],
  }))
}

export async function getReview(userId: string, id: string): Promise<ReviewRecord | null> {
  const [review] = await listReviews(userId, id)
  return review ?? null
}

export async function chartsForReview(userId: string, reviewId: string): Promise<ChartRecord[]> {
  const rows = await db
    .select({ chart: reviewCharts })
    .from(reviewCharts)
    .innerJoin(reviewLegs, eq(reviewCharts.legId, reviewLegs.id))
    .where(and(eq(reviewCharts.userId, userId), eq(reviewLegs.reviewId, reviewId)))
  return rows.map(({ chart }) => ({
    id: chart.id,
    legId: chart.legId,
    interval: chart.interval,
    source: chart.source,
    capturedAt: chart.capturedAt,
    bars: chart.bars,
  }))
}

export interface LegInput {
  /** Absent on a leg added in this save. */
  id?: string
  kind: LegKind
  tradeId: string | null
  date: string
  time: string | null
  price: string
  quantity: string
  fee: string
  rating: number | null
  explanation: string
}

export interface ReviewHeader {
  playbookId: string | null
  stopPrice: string | null
  targetPrice: string | null
  accountEquity: string | null
  riskRatingOverride: number | null
  criteriaMet: string[]
  mistakes: string[]
  lessons: string
}

export interface NewReview {
  kind: ReviewKind
  playbookId: string | null
  symbol: string
  name: string
  assetClass: AssetClass
  currency: Currency
  accountType: AccountType | null
  tradeIds: string[]
}

/** A linked trade as a leg — its own figures, so the copy matches the trade it came from. */
interface LinkedTrade {
  id: string
  kind: LegKind
  date: string
  price: string
  quantity: string
  fee: string
  symbol: string
  name: string
  assetClass: AssetClass
  currency: Currency
  accountType: AccountType
}

async function linkedTrades(userId: string, ids: string[]): Promise<LinkedTrade[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ trade: trades, instrument: instruments })
    .from(trades)
    .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
    .where(and(eq(trades.userId, userId), inArray(trades.id, ids), isNull(trades.deletedAt)))
  return rows.map(({ trade, instrument }) => ({
    id: trade.id,
    kind: trade.side === 'SELL' || trade.side === 'REDEEM' ? 'EXIT' : 'ENTRY',
    date: trade.tradeDate,
    price: trade.unitPrice,
    quantity: trade.quantity,
    fee: new Decimal(trade.fee).add(trade.feeTax).add(trade.otherCost).toFixed(),
    symbol: instrument.symbol,
    name: instrument.name,
    assetClass: instrument.assetClass,
    currency: trade.currency,
    accountType: trade.accountType,
  }))
}

/**
 * Checks that every trade a REAL review links is the caller's, is live, and
 * is from the review's pool — and returns them by id.
 *
 * The pool is the point: 移動平均法 averages within (symbol × account), so a
 * NISA buy on a 特定 review would be a leg with no bearing on the result it
 * is being scored against.
 */
async function poolTrades(
  userId: string,
  ids: string[],
  pool: { symbol: string; accountType: AccountType | null },
): Promise<Map<string, LinkedTrade>> {
  const found = await linkedTrades(userId, ids)
  const byId = new Map(found.map((trade) => [trade.id, trade]))
  for (const id of ids) {
    const trade = byId.get(id)
    if (!trade) throw new Error('A linked trade no longer exists. Reload and try again.')
    if (trade.symbol !== pool.symbol || trade.accountType !== pool.accountType) {
      throw new Error(
        `Only ${pool.symbol} trades from the same account can be linked to this review.`,
      )
    }
  }
  return byId
}

export async function createReview(userId: string, input: NewReview): Promise<string> {
  const id = newId('review')
  const linked = input.kind === 'REAL' ? await linkedTrades(userId, input.tradeIds) : []
  if (input.kind === 'REAL') {
    if (linked.length === 0) throw new Error('Pick at least one trade to review.')
    const first = linked[0]!
    if (
      linked.some(
        (trade) => trade.symbol !== first.symbol || trade.accountType !== first.accountType,
      )
    ) {
      throw new Error('A review covers one symbol in one account.')
    }
  }
  const pool = linked[0]

  try {
    await db.transaction(async (tx) => {
      await tx.insert(tradeReviews).values({
        id,
        userId,
        kind: input.kind,
        playbookId: input.playbookId,
        // A real review takes its identity from the trades, never from the form.
        symbol: pool?.symbol ?? input.symbol,
        name: pool?.name ?? input.name,
        assetClass: pool?.assetClass ?? input.assetClass,
        currency: pool?.currency ?? input.currency,
        accountType: pool?.accountType ?? null,
      })
      if (linked.length > 0) {
        await tx.insert(reviewLegs).values(
          [...linked]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((trade, position) => ({
              id: newId('leg'),
              reviewId: id,
              userId,
              kind: trade.kind,
              tradeId: trade.id,
              date: trade.date,
              price: trade.price,
              quantity: trade.quantity,
              fee: trade.fee,
              position,
            })),
        )
      }
    })
  } catch (error) {
    if (isUniqueViolation(error))
      throw new Error('One of those trades is already in another review.')
    throw error
  }
  return id
}

/**
 * Saves a review as one document: the header, and its legs as a set.
 *
 * Legs missing from the input are deleted (their charts with them), ids that
 * exist are updated, and the rest inserted — in one transaction, so a refused
 * link cannot leave half the legs saved.
 */
export async function saveReview(
  userId: string,
  id: string,
  header: ReviewHeader,
  legs: LegInput[],
): Promise<void> {
  const review = await getReview(userId, id)
  if (!review) throw new Error('review not found')

  const tradeIds = legs.flatMap((leg) => (leg.tradeId ? [leg.tradeId] : []))
  if (new Set(tradeIds).size !== tradeIds.length) throw new Error('A trade can only be one leg.')
  if (review.kind === 'PAPER' && tradeIds.length > 0)
    throw new Error('A paper trade has no real trades to link.')
  // A real review's result is the engine's, over its linked trades — a typed-in
  // leg would move the averages without moving the result they are scored against.
  if (review.kind === 'REAL' && tradeIds.length !== legs.length) {
    throw new Error('Every leg of a real review is one of its trades.')
  }
  // Links this review already holds are not re-checked: a trade soft-deleted
  // since must not make the review unsaveable. Such a leg keeps its stored copy.
  const already = new Set(review.legs.flatMap((leg) => (leg.tradeId ? [leg.tradeId] : [])))
  const linked = new Map<string, LinkedTrade>()
  if (review.kind === 'REAL') {
    const fresh = await poolTrades(
      userId,
      tradeIds.filter((tradeId) => !already.has(tradeId)),
      review,
    )
    const held = await linkedTrades(
      userId,
      tradeIds.filter((tradeId) => already.has(tradeId)),
    )
    for (const trade of [...fresh.values(), ...held]) linked.set(trade.id, trade)
  }

  const existing = new Set(review.legs.map((leg) => leg.id))
  const kept = new Set(legs.flatMap((leg) => (leg.id && existing.has(leg.id) ? [leg.id] : [])))
  const removed = [...existing].filter((legId) => !kept.has(legId))

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(tradeReviews)
        .set({ ...header, updatedAt: new Date() })
        .where(and(eq(tradeReviews.userId, userId), eq(tradeReviews.id, id)))

      if (removed.length > 0) {
        await tx
          .delete(reviewLegs)
          .where(and(eq(reviewLegs.userId, userId), inArray(reviewLegs.id, removed)))
      }

      for (const [position, leg] of legs.entries()) {
        const trade = leg.tradeId ? linked.get(leg.tradeId) : undefined
        if (trade && trade.kind !== leg.kind) {
          throw new Error(
            `The ${trade.date} trade is ${trade.kind === 'ENTRY' ? 'a buy' : 'a sell'}.`,
          )
        }
        // A linked leg's figures are the trade's, whatever the form sent.
        const values = {
          kind: leg.kind,
          tradeId: leg.tradeId,
          date: trade?.date ?? leg.date,
          time: leg.time,
          price: trade?.price ?? leg.price,
          quantity: trade?.quantity ?? leg.quantity,
          fee: trade?.fee ?? leg.fee,
          rating: leg.rating,
          explanation: leg.explanation,
          position,
        }
        if (leg.id && kept.has(leg.id)) {
          await tx
            .update(reviewLegs)
            .set(values)
            .where(and(eq(reviewLegs.userId, userId), eq(reviewLegs.id, leg.id)))
        } else {
          await tx.insert(reviewLegs).values({ id: newId('leg'), reviewId: id, userId, ...values })
        }
      }
    })
  } catch (error) {
    if (isUniqueViolation(error))
      throw new Error('One of those trades is already in another review.')
    throw error
  }
}

export async function deleteReview(userId: string, id: string): Promise<void> {
  await db.delete(tradeReviews).where(and(eq(tradeReviews.userId, userId), eq(tradeReviews.id, id)))
}

/** The trade ids already in some review — the candidates list hides them. */
export async function reviewedTradeIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ tradeId: reviewLegs.tradeId })
    .from(reviewLegs)
    .where(eq(reviewLegs.userId, userId))
  return new Set(rows.flatMap((row) => (row.tradeId ? [row.tradeId] : [])))
}

// ── Charts ──────────────────────────────────────────────────────────────────

export async function legWithReview(
  userId: string,
  legId: string,
): Promise<{ leg: LegRecord; review: ReviewRecord } | null> {
  const [row] = await db
    .select({ reviewId: reviewLegs.reviewId })
    .from(reviewLegs)
    .where(and(eq(reviewLegs.userId, userId), eq(reviewLegs.id, legId)))
  if (!row) return null
  const review = await getReview(userId, row.reviewId)
  const leg = review?.legs.find((candidate) => candidate.id === legId)
  if (!review || !leg) return null
  if (!leg.tradeId) return { leg, review }

  // A linked leg is dated by its trade, which may have been re-dated since.
  const [trade] = await db
    .select({ tradeDate: trades.tradeDate })
    .from(trades)
    .where(and(eq(trades.userId, userId), eq(trades.id, leg.tradeId), isNull(trades.deletedAt)))
  return { leg: { ...leg, date: trade?.tradeDate ?? leg.date }, review }
}

/** Captures, or recaptures, a leg's chart on one timeframe. */
export async function saveChart(
  userId: string,
  legId: string,
  chart: { interval: string; source: CandleSource; bars: Candle[] },
): Promise<string> {
  const [row] = await db
    .insert(reviewCharts)
    .values({ id: newId('chart'), legId, userId, ...chart })
    .onConflictDoUpdate({
      target: [reviewCharts.legId, reviewCharts.interval],
      set: { source: chart.source, bars: chart.bars, capturedAt: new Date() },
    })
    .returning({ id: reviewCharts.id })
  if (!row) throw new Error('failed to save chart')
  return row.id
}

export async function deleteChart(userId: string, id: string): Promise<void> {
  await db.delete(reviewCharts).where(and(eq(reviewCharts.userId, userId), eq(reviewCharts.id, id)))
}
