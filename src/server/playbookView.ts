/**
 * The Playbook as the screens read it: stored positions joined to the trade
 * history, the engine's closes and the exit framework, and turned into strings.
 *
 * No `createServerFn` export, so nothing here reaches a client stub — the same
 * reason `server/engine.ts` has none. `server/playbook.ts` calls these from
 * inside handler bodies.
 */
import type Decimal from 'decimal.js'
import { engineFor } from './engine'
import { evaluateExitRule, exitRuleRow, holdingContext, type ExitRuleRow } from './exitPosition'
import {
  barsFor,
  getAccountEquity,
  getExitSettings,
  listExitRules,
  type ExitRuleRecord,
} from '~/db/exit.service'
import { imageStoreMode } from '~/db/imageStore'
import {
  claimedStreaks,
  getJournalEntry,
  listJournalEntries,
  listJournalImages,
  listSetups,
  toStreakTrades,
  unfiledPlans,
  type JournalEntryRecord,
  type JournalImageRecord,
  type SetupRecord,
} from '~/db/playbook.service'
import { usdJpyRate } from '~/db/prices.service'
import { marketOf, OPENING_SIDES, type AccountType, type AssetClass, type NormalizedTrade } from '~/lib/domain/types'
import { initialStopFor, target1For } from '~/lib/exit/rules'
import type { TrailingMethod } from '~/lib/exit/types'
import { webhookSecretUsable } from '~/lib/exit/webhook'
import type { GalleryImage } from '~/lib/playbook/images'
import { derivePosition, type DerivedLeg, type DerivedPosition, type PlanBasis } from '~/lib/playbook/position'
import {
  holdingStreaks,
  isOpen,
  linkCandidates,
  linkedPlanDate,
  streakOfPlan,
  type HoldingStreak,
} from '~/lib/playbook/streaks'
import type { Criterion, ExtraTarget, JournalKind, LegSide, PositionStatus } from '~/lib/playbook/types'
import type { RealizedEvent } from '~/lib/pnl/engine'

type Currency = 'JPY' | 'USD'

const currencyFor = (assetClass: AssetClass): Currency => (assetClass === 'US_EQUITY' ? 'USD' : 'JPY')
const lotSizeFor = (assetClass: AssetClass): number => (assetClass === 'US_EQUITY' ? 1 : 100)
const price = (value: Decimal | null | undefined): string | null => value?.toFixed(2) ?? null
const score = (value: number | null): string | null => (value === null ? null : value.toFixed(1))

export { lotSizeFor }

export interface PositionRow {
  id: string
  kind: JournalKind
  symbol: string
  name: string
  assetClass: AssetClass
  /** Null for paper. */
  accountType: AccountType | null
  currency: Currency
  setupId: string | null
  setupName: string | null
  status: PositionStatus
  openDate: string
  closeDate: string | null
  /** Dollars for a US close, yen otherwise; a paper trade in its own currency. Null until something closes. */
  result: string | null
  /** The yen the dashboard totals by; null for paper. */
  resultJpy: string | null
  returnPct: number | null
  r: string | null
  entryScore: string | null
  exitScore: string | null
  riskScore: string | null
  overall: string | null
  provisional: boolean
  /** The live plan; null otherwise. */
  plan: ExitRuleRow | null
  /** Awaiting import, with trades there to link. */
  linkable: boolean
}

export interface UnfiledPlanRow {
  planId: string
  symbol: string
  name: string
  accountType: AccountType
  entryDate: string
}

export interface PlaybookData {
  rows: PositionRow[]
  /** Open plans the framework rates urgent or attention, and live plans on finished positions. */
  needsAction: PositionRow[]
  setups: { id: string; name: string }[]
  /** Live plans with a streak to file under. */
  plansToFile: number
  /** Live plans with no streak to file under: they can only be archived. */
  orphanPlans: UnfiledPlanRow[]
  webhookConfigured: boolean
}

/** Everything the Playbook's screens derive from, loaded once per request. */
async function loadBook(userId: string, includeArchived = false) {
  const [{ records, trades, engine }, entries, allEntries, plans, settings, setups] = await Promise.all([
    engineFor(userId),
    listJournalEntries(userId),
    includeArchived ? listJournalEntries(userId, { includeArchived: true }) : Promise.resolve(null),
    listExitRules(userId, true),
    getExitSettings(userId),
    listSetups(userId, true),
  ])
  const streaks = holdingStreaks(toStreakTrades(records))
  const realizedBy = new Map<NormalizedTrade, RealizedEvent>(engine.realized.map((close) => [close.trade, close]))
  const livePlans = plans.filter((plan) => plan.archivedAt === null)
  const bars = await barsFor([...new Set(livePlans.map((plan) => plan.instrumentId))])
  const holdings = holdingContext(engine.positions, trades, allEntries ?? entries, streaks)
  const now = new Date()
  const planRow = (plan: ExitRuleRecord): ExitRuleRow =>
    exitRuleRow(plan, evaluateExitRule(plan, holdings, bars.get(plan.instrumentId) ?? [], settings, now))
  return { entries, streaks, realizedBy, plans, settings, setups, planRow }
}

/** A plan's locked entry facts, live or archived. */
export function planBasis(plan: ExitRuleRecord): PlanBasis {
  const { stop } = initialStopFor(plan)
  return {
    entryPrice: plan.entryPrice,
    stop,
    target1: target1For(plan, plan.entryPrice.sub(stop)),
    shares: plan.totalShares,
  }
}

function toRow(
  entry: JournalEntryRecord,
  derived: DerivedPosition,
  setups: readonly SetupRecord[],
  plan: ExitRuleRow | null,
  linkable: boolean,
): PositionRow {
  const { score: parts, result } = derived
  return {
    id: entry.id,
    kind: entry.kind,
    symbol: entry.symbol,
    name: entry.name,
    assetClass: entry.assetClass,
    accountType: entry.accountType,
    currency: currencyFor(entry.assetClass),
    setupId: entry.setupId,
    setupName: setups.find((setup) => setup.id === entry.setupId)?.name ?? null,
    status: derived.status,
    openDate: derived.openDate,
    closeDate: derived.closeDate,
    result: result?.shown.toFixed(2) ?? null,
    resultJpy: result?.jpy?.toFixed(0) ?? null,
    returnPct: result?.returnPct?.toNumber() ?? null,
    r: derived.r?.toFixed(2) ?? null,
    entryScore: score(parts.entry),
    exitScore: score(parts.exit),
    riskScore: score(parts.risk),
    overall: score(parts.overall),
    provisional: parts.provisional,
    plan,
    linkable,
  }
}

const STATUS_RANK: Record<PositionStatus, number> = { MISSING: 0, AWAITING_IMPORT: 1, OPEN: 1, CLOSED: 2 }

/** Open first, then most recent — the order the table starts in. */
const byDefaultOrder = (left: PositionRow, right: PositionRow): number =>
  STATUS_RANK[left.status] - STATUS_RANK[right.status] || right.openDate.localeCompare(left.openDate)

const SEVERITY_RANK: Record<ExitRuleRow['actionSeverity'], number> = { urgent: 0, attention: 1, neutral: 2 }

const retired = (plan: ExitRuleRow): boolean =>
  plan.actionKind === 'POSITION_CLOSED' || plan.actionKind === 'PLAN_SUPERSEDED'

export async function playbookData(userId: string): Promise<PlaybookData> {
  const book = await loadBook(userId, true)
  const claimed = claimedStreaks(book.entries, book.streaks)
  const planFor = new Map(book.plans.flatMap((plan) => (plan.journalId ? [[plan.journalId, plan] as const] : [])))

  const rows = book.entries
    .map((entry) => {
      const plan = planFor.get(entry.id)
      const derived = derivePosition(entry, book.streaks, book.realizedBy, plan ? planBasis(plan) : null)
      const linkable =
        derived.status === 'AWAITING_IMPORT' &&
        entry.accountType !== null &&
        linkCandidates({ ...entry, accountType: entry.accountType }, book.streaks, claimed).length > 0
      return toRow(entry, derived, book.setups, plan?.archivedAt === null ? book.planRow(plan) : null, linkable)
    })
    .sort(byDefaultOrder)

  const unfiled = unfiledPlans(book.plans, book.streaks, claimed)
  return {
    rows,
    needsAction: rows
      .filter((row) => row.plan && (row.plan.actionSeverity !== 'neutral' || retired(row.plan)))
      .sort(
        (left, right) =>
          SEVERITY_RANK[left.plan!.actionSeverity] - SEVERITY_RANK[right.plan!.actionSeverity] ||
          right.plan!.tradingDaysHeld - left.plan!.tradingDaysHeld,
      ),
    setups: book.setups.filter((setup) => !setup.archivedAt).map(({ id, name }) => ({ id, name })),
    plansToFile: unfiled.filter((item) => item.streak).length,
    orphanPlans: unfiled
      .filter((item) => !item.streak)
      .map(({ plan }) => ({
        planId: plan.id,
        symbol: plan.symbol,
        name: plan.name,
        accountType: plan.accountType,
        entryDate: plan.entryDate,
      })),
    webhookConfigured: webhookSecretUsable(process.env.TRADINGVIEW_WEBHOOK_SECRET),
  }
}

// ── One position ────────────────────────────────────────────────────────────

export interface LegView {
  side: LegSide
  date: string
  firstTradeId: string | null
  annotationId: string | null
  quantity: string
  averagePrice: string
  fills: number
  executedAt: string | null
  allTimed: boolean
  rating: number | null
  note: string
  noteFromMemos: boolean
}

export interface UnattachedLeg {
  id: string
  side: LegSide
  date: string
  rating: number | null
  note: string | null
}

export type PlanView =
  | {
      kind: 'LIVE'
      row: ExitRuleRow
      stopMultiple: string
      targetMultiple: string
      target1Manual: boolean
      /** Unrounded, for Edit plan: `row` is for reading, and saving it back would round the locked facts. */
      exact: { entryPrice: string; supportLevel: string; target1Override: string | null }
    }
  | { kind: 'ARCHIVED'; stop: string; target1: string; entryPrice: string; supportLevel: string }
  | { kind: 'STATIC'; stop: string | null; target1: string | null }

export interface LinkCandidate {
  anchorId: string
  entryDate: string
  closeDate: string | null
  entryPrice: string
  shares: string
  fills: { id: string; date: string; side: LegSide; quantity: string; price: string }[]
  /** Against the plan's entry facts, so the owner can be offered the correction. */
  planDiffers: boolean
  /** The date that correction moves the plan to; null when it stays. */
  planDateTo: string | null
}

export interface TypedLegView {
  id: string
  side: LegSide
  date: string
  executedAt: string | null
  price: string
  quantity: string
  fee: string
}

export interface PositionDetail extends PositionRow {
  archived: boolean
  setup: { id: string; name: string; criteria: Criterion[] } | null
  setups: { id: string; name: string }[]
  legs: LegView[]
  unattached: UnattachedLeg[]
  /** Editable here only while awaiting import, and on paper. */
  typedLegs: TypedLegView[] | null
  plan: ExitRuleRow | null
  planView: PlanView
  /** Global settings shown read-only beside a live plan. */
  framework: { partialExitFraction: string; timeStopDays: number; trailingAtrMultiple: string }
  extraTargets: ExtraTarget[]
  entryPrice: string | null
  stop: string | null
  target1: string | null
  /** Unrounded, for Edit plan to start from. */
  exactStop: string | null
  exactTarget1: string | null
  riskPerShare: string | null
  plannedR: string | null
  riskAmount: string | null
  riskPct: number | null
  sizePct: number | null
  accountEquity: string | null
  sharesHeld: string
  riskRatingOverride: number | null
  criteriaMet: string[]
  mistakes: string[]
  /** Tags used on other positions. */
  mistakeSuggestions: string[]
  lessons: string
  candidates: LinkCandidate[]
  images: GalleryImage[]
  /** False when no store is configured: the upload control says so. */
  imagesEnabled: boolean
}

const legView = (leg: DerivedLeg): LegView => ({
  side: leg.side,
  date: leg.date,
  firstTradeId: leg.firstTradeId,
  annotationId: leg.annotationId,
  quantity: leg.quantity.toFixed(),
  averagePrice: leg.averagePrice.toFixed(2),
  fills: leg.fills,
  executedAt: leg.executedAt?.toISOString() ?? null,
  allTimed: leg.allTimed,
  rating: leg.rating,
  note: leg.note,
  noteFromMemos: leg.noteFromMemos,
})

function candidateView(streak: HoldingStreak, plan: ExitRuleRecord | undefined): LinkCandidate {
  const correctedDate = plan ? linkedPlanDate(plan, streak.entryDate) : null
  const planDateTo = correctedDate !== plan?.entryDate ? correctedDate : null
  return {
    anchorId: streak.anchorId,
    entryDate: streak.entryDate,
    closeDate: streak.closeDate,
    entryPrice: streak.entryPrice.toFixed(2),
    shares: streak.sharesBought.toFixed(),
    fills: streak.trades.map((record) => ({
      id: record.id,
      date: record.trade.tradeDate,
      side: OPENING_SIDES.includes(record.trade.side) ? 'ENTRY' : 'EXIT',
      quantity: record.trade.quantity.toFixed(),
      price: record.trade.unitPrice.toFixed(2),
    })),
    planDiffers:
      plan !== undefined &&
      (!plan.entryPrice.eq(streak.entryPrice) || !plan.totalShares.eq(streak.sharesBought) || planDateTo !== null),
    planDateTo,
  }
}

function planViewOf(
  entry: JournalEntryRecord,
  plan: ExitRuleRecord | undefined,
  row: ExitRuleRow | null,
): PlanView {
  if (plan && row) {
    return {
      kind: 'LIVE',
      row,
      stopMultiple: plan.entryStopAtrMultiple.toFixed(),
      targetMultiple: plan.entryTargetMultiple.toFixed(),
      target1Manual: plan.target1Override !== null,
      exact: {
        entryPrice: plan.entryPrice.toFixed(),
        supportLevel: plan.supportLevel.toFixed(),
        target1Override: plan.target1Override?.toFixed() ?? null,
      },
    }
  }
  if (plan) {
    const basis = planBasis(plan)
    return {
      kind: 'ARCHIVED',
      stop: basis.stop.toFixed(2),
      target1: basis.target1.toFixed(2),
      entryPrice: plan.entryPrice.toFixed(2),
      supportLevel: plan.supportLevel.toFixed(2),
    }
  }
  return { kind: 'STATIC', stop: price(entry.stopPrice), target1: price(entry.target1Price) }
}

const galleryImage = (image: JournalImageRecord): GalleryImage => ({
  id: image.id,
  phase: image.phase,
  timeframe: image.timeframe,
  caption: image.caption,
  width: image.width,
  height: image.height,
  url: `/api/images/${image.id}`,
  thumbUrl: `/api/images/${image.id}?size=thumb`,
})

export async function positionDetail(userId: string, id: string): Promise<PositionDetail | null> {
  const entry = await getJournalEntry(userId, id)
  if (!entry) return null
  // Rows only: nothing here touches the store, so an outage there cannot break this.
  const [book, images] = await Promise.all([loadBook(userId, true), listJournalImages(userId, id)])
  const plan = book.plans.find((candidate) => candidate.journalId === id)
  const derived = derivePosition(entry, book.streaks, book.realizedBy, plan ? planBasis(plan) : null)
  const row = plan?.archivedAt === null ? book.planRow(plan) : null

  const relinkable = derived.status === 'AWAITING_IMPORT' || derived.status === 'MISSING'
  const candidates =
    relinkable && entry.accountType
      ? linkCandidates(
          { ...entry, accountType: entry.accountType },
          book.streaks,
          claimedStreaks(book.entries, book.streaks, id),
        )
      : []

  const setup = book.setups.find((candidate) => candidate.id === entry.setupId)
  const typedEditable = entry.kind === 'PAPER' || entry.anchorTradeId === null
  return {
    ...toRow(entry, derived, book.setups, row, candidates.length > 0),
    archived: entry.archivedAt !== null,
    setup: setup ? { id: setup.id, name: setup.name, criteria: setup.criteria } : null,
    setups: book.setups.filter((candidate) => !candidate.archivedAt).map(({ id: setupId, name }) => ({ id: setupId, name })),
    legs: derived.legs.map(legView),
    unattached: derived.unattached.map((leg) => ({
      id: leg.id,
      side: leg.side,
      date: leg.date,
      rating: leg.rating,
      note: leg.note,
    })),
    typedLegs: typedEditable
      ? entry.legs.map((leg) => ({
          id: leg.id,
          side: leg.side,
          date: leg.date,
          executedAt: leg.executedAt?.toISOString() ?? null,
          price: leg.price?.toFixed() ?? '',
          quantity: leg.quantity?.toFixed() ?? '',
          fee: leg.fee?.toFixed() ?? '0',
        }))
      : null,
    planView: planViewOf(entry, plan, row),
    framework: {
      partialExitFraction: book.settings.partialExitFraction.toFixed(2),
      timeStopDays: book.settings.timeStopDays,
      trailingAtrMultiple: book.settings.trailingAtrMultiple.toFixed(2),
    },
    extraTargets: entry.extraTargets,
    entryPrice: price(derived.entryPrice),
    stop: price(derived.stop),
    target1: price(derived.target1),
    exactStop: derived.stop?.toFixed() ?? null,
    exactTarget1: derived.target1?.toFixed() ?? null,
    riskPerShare: price(derived.riskPerShare),
    plannedR: derived.plannedR?.toFixed(2) ?? null,
    riskAmount: derived.riskAmount?.toFixed(2) ?? null,
    riskPct: derived.riskPct?.toNumber() ?? null,
    sizePct: derived.sizePct?.toNumber() ?? null,
    accountEquity: entry.accountEquity?.toFixed() ?? null,
    sharesHeld: derived.sharesHeld.toFixed(),
    riskRatingOverride: entry.riskRatingOverride,
    criteriaMet: entry.criteriaMet,
    mistakes: entry.mistakes,
    mistakeSuggestions: [
      ...new Set(book.entries.filter((other) => other.id !== id).flatMap((other) => other.mistakes)),
    ]
      .filter((tag) => !entry.mistakes.includes(tag))
      .sort(),
    lessons: entry.lessons,
    // Linking only ever corrects a live plan.
    candidates: candidates.map((streak) => candidateView(streak, plan?.archivedAt === null ? plan : undefined)),
    images: images.map(galleryImage),
    imagesEnabled: imageStoreMode() !== 'DISABLED',
  }
}

// ── Opening a position ──────────────────────────────────────────────────────

export interface StreakCandidate {
  anchorTradeId: string
  symbol: string
  name: string
  assetClass: AssetClass
  market: 'JP' | 'US'
  accountType: AccountType
  currency: Currency
  entryDate: string
  closeDate: string | null
  /** Blended over the streak. */
  entryPrice: string
  /** Bought over the streak, before any partial exit. */
  shares: string
  lotSize: number
  /** From an archived plan that covered this streak. */
  prefill: { supportLevel: string; stopMultiple: string; targetMultiple: string; target1Override: string | null } | null
}

export interface OpenOptions {
  holdings: StreakCandidate[]
  pastTrades: StreakCandidate[]
  setups: { id: string; name: string; description: string; criteria: Criterion[] }[]
  defaults: {
    stopMultiple: string
    targetMultiple: string
    trailingMethod: TrailingMethod
    partialExitFraction: string
    timeStopDays: number
    trailingAtrMultiple: string
    /** The account size from Settings, in each position currency. */
    accountEquity: Record<Currency, string | null>
  }
  /** False when no store is configured: step 3 says so. */
  imagesEnabled: boolean
}

/** Only listed equities get plans — no provider feeds a fund's 基準価額. */
const planned = (streak: HoldingStreak): boolean => streak.trades[0]?.trade.assetClass !== 'FUND'

export async function openOptions(userId: string): Promise<OpenOptions> {
  const [book, equity, usdJpy] = await Promise.all([loadBook(userId), getAccountEquity(userId), usdJpyRate()])
  const claimed = claimedStreaks(book.entries, book.streaks)

  // A live plan with no position already covers its streak: that one is filed
  // from the Playbook's prompt, and offering it here would only be refused.
  const unfiled = new Set(
    book.plans.flatMap((plan) => {
      if (plan.journalId !== null || plan.archivedAt !== null) return []
      const streak = streakOfPlan(plan, book.streaks)
      return streak ? [streak.anchorId] : []
    }),
  )
  const archivedPlan = (streak: HoldingStreak) =>
    book.plans.find(
      (plan) =>
        plan.archivedAt !== null &&
        plan.journalId === null &&
        streakOfPlan(plan, book.streaks)?.anchorId === streak.anchorId,
    )

  const candidate = (streak: HoldingStreak): StreakCandidate => {
    const { trade } = streak.trades[0]!
    const plan = archivedPlan(streak)
    return {
      anchorTradeId: streak.anchorId,
      symbol: streak.symbol,
      name: trade.name,
      assetClass: trade.assetClass,
      market: marketOf(trade.assetClass),
      accountType: streak.accountType,
      currency: currencyFor(trade.assetClass),
      entryDate: streak.entryDate,
      closeDate: streak.closeDate,
      entryPrice: streak.entryPrice.toFixed(2),
      shares: streak.sharesBought.toFixed(),
      lotSize: lotSizeFor(trade.assetClass),
      prefill: plan
        ? {
            // The stop itself, as its support: with the plan's own multiple the
            // framework's lower-of-the-two lands back on this same figure.
            supportLevel: planBasis(plan).stop.toFixed(2),
            stopMultiple: plan.entryStopAtrMultiple.toFixed(),
            targetMultiple: plan.entryTargetMultiple.toFixed(),
            target1Override: plan.target1Override?.toFixed() ?? null,
          }
        : null,
    }
  }

  const unclaimed = book.streaks.filter((streak) => planned(streak) && !claimed.has(streak.anchorId))
  return {
    holdings: unclaimed
      .filter((streak) => isOpen(streak) && !unfiled.has(streak.anchorId))
      .map(candidate)
      .sort((left, right) => left.symbol.localeCompare(right.symbol)),
    pastTrades: unclaimed
      .filter((streak) => !isOpen(streak))
      .map(candidate)
      .sort((left, right) => (right.closeDate ?? '').localeCompare(left.closeDate ?? '')),
    setups: book.setups
      .filter((setup) => !setup.archivedAt)
      .map(({ id, name, description, criteria }) => ({ id, name, description, criteria })),
    imagesEnabled: imageStoreMode() !== 'DISABLED',
    defaults: {
      stopMultiple: book.settings.initialStopAtrMultiple.toFixed(),
      targetMultiple: book.settings.targetMultiple.toFixed(),
      trailingMethod: book.settings.trailingMethod,
      partialExitFraction: book.settings.partialExitFraction.toFixed(2),
      timeStopDays: book.settings.timeStopDays,
      trailingAtrMultiple: book.settings.trailingAtrMultiple.toFixed(2),
      accountEquity: {
        JPY: equity?.toFixed() ?? null,
        // Stored on a position in its own currency, since its prices are; today's
        // rate is only the prefill, and the figure locks when the position is filed.
        USD: equity && usdJpy?.gt(0) ? equity.div(usdJpy).toFixed(0) : null,
      },
    },
  }
}
