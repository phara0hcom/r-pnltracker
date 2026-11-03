/**
 * Server functions for the Playbook. Every one is `authed`, and validators read
 * only the client-safe `lib/playbook/schemas.ts`.
 *
 * Refusals the owner can act on come back as `{ ok: false, message }` rather than
 * as thrown errors, as `reorderDay` does: they are answers, not failures, and
 * must not reach Sentry.
 */
import { createServerFn } from '@tanstack/react-start'
import Decimal from 'decimal.js'
import { authed } from './middleware'
import { lotSizeFor, openOptions, playbookData, positionDetail } from './playbookView'
import { archiveExitRule, entryAtrFor, getExitRule, listExitRules, updateExitRule } from '~/db/exit.service'
import {
  archiveJournalEntry,
  createJournalEntry,
  createSetup,
  deleteJournalEntry,
  fileExistingPlans,
  getJournalEntry,
  linkJournalEntry,
  listSetups,
  reattachAnnotation,
  replaceTypedLegs,
  scratchProblem,
  setLegAnnotation,
  setLegTime,
  updateJournalEntry,
  type JournalEntryInput,
  type LivePlanInput,
} from '~/db/playbook.service'
import { canonicalSymbol } from '~/lib/domain/instruments'
import type { AssetClass } from '~/lib/domain/types'
import { planLevels } from '~/lib/playbook/plan'
import {
  annotationSchema,
  legTimeSchema,
  linkSchema,
  openPositionSchema,
  positionIdSchema,
  previewPlanSchema,
  reattachSchema,
  setupSchema,
  updatePlanSchema,
  updatePositionSchema,
} from '~/lib/playbook/schemas'
import { extraTargetsProblem, staticPlanProblem, symbolProblem } from '~/lib/playbook/validate'

export type {
  LegView,
  LinkCandidate,
  OpenOptions,
  PlanView,
  PlaybookData,
  PositionDetail,
  PositionRow,
  StreakCandidate,
  TypedLegView,
  UnattachedLeg,
  UnfiledPlanRow,
} from './playbookView'

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; message: string }

const refused = (message: string): { ok: false; message: string } => ({ ok: false, message })

export const getPlaybook = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(({ context }) => playbookData(context.userId))

export const getPosition = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((data: unknown) => positionIdSchema.parse(data))
  .handler(({ data, context }) => positionDetail(context.userId, data.id))

export const getOpenOptions = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(({ context }) => openOptions(context.userId))

export interface PlanPreview {
  stop: string
  fromSupportOnly: boolean
  riskPerShare: string
  target1: string
  plannedR: string
  riskAmount: string
  riskPct: number | null
  sizePct: number | null
  riskRating: string | null
}

/**
 * The dialog's live preview. POST though it writes nothing: a GET would carry the
 * figures in the URL and be saved to the device by the service worker.
 */
export const previewExitPlan = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => previewPlanSchema.parse(data))
  .handler(async ({ data }): Promise<ActionResult<{ preview: PlanPreview }>> => {
    const levels = planLevels(data, await entryAtrFor(canonicalSymbol(data.symbol.trim()), data.entryDate))
    if (typeof levels === 'string') return refused(levels)
    return {
      ok: true,
      preview: {
        stop: levels.stop.toFixed(2),
        fromSupportOnly: levels.fromSupportOnly,
        riskPerShare: levels.riskPerShare.toFixed(2),
        target1: levels.target1.toFixed(2),
        plannedR: levels.plannedR.toFixed(2),
        riskAmount: levels.riskAmount.toFixed(2),
        riskPct: levels.riskPct?.toNumber() ?? null,
        sizePct: levels.sizePct?.toNumber() ?? null,
        riskRating: levels.riskRating?.toFixed(1) ?? null,
      },
    }
  })

export const openPosition = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => openPositionSchema.parse(data))
  .handler(async ({ data, context }): Promise<ActionResult<{ id: string; live: boolean }>> => {
    const { userId } = context
    const scratch = data.source === 'SCRATCH'
    const anchored = !scratch
    const assetClass: AssetClass = data.market === 'US' ? 'US_EQUITY' : 'JP_EQUITY'
    const symbol = scratch ? canonicalSymbol(data.symbol.trim().toUpperCase()) : data.symbol
    const kind = data.paper ? 'PAPER' : 'REAL'
    const accountType = data.paper ? null : data.accountType

    if (data.paper && !scratch) return refused('A paper position is typed in from scratch.')
    if (anchored && !data.anchorTradeId) return refused('Choose the trades it covers.')
    if (!data.paper && !accountType) return refused('Choose the account it was traded in.')
    if (scratch) {
      const problem = symbolProblem(symbol, data.market)
      if (problem) return refused(problem)
    }
    if (scratch && !data.paper) {
      const problem = await scratchProblem(userId, { symbol, accountType })
      if (problem) return refused(problem)
    }

    // Real and held: a live plan, without which the framework has nothing to say.
    const wantsLive = !data.paper && data.source !== 'PAST'
    if (wantsLive && !data.plan) return refused('A real position needs its exit plan: set a support level.')

    const levels =
      data.plan &&
      planLevels(
        {
          entryPrice: data.entryPrice,
          shares: data.shares,
          supportLevel: data.plan.supportLevel,
          stopMultiple: data.plan.stopMultiple,
          targetMultiple: data.plan.targetMultiple,
          target1Override: data.plan.target1Override,
          extraTargets: data.extraTargets,
          accountEquity: data.accountEquity,
        },
        await entryAtrFor(symbol, data.entryDate),
      )
    if (typeof levels === 'string') return refused(levels)
    const targetsProblem = extraTargetsProblem(data.extraTargets)
    if (targetsProblem) return refused(targetsProblem)

    const input: JournalEntryInput = {
      kind,
      setupId: data.setupId,
      symbol,
      name: data.name || symbol,
      assetClass,
      accountType,
      entryDate: data.entryDate,
      anchorTradeId: data.anchorTradeId,
      // Computed once and stored; only a position with no live plan has these.
      stopPrice: !wantsLive && levels ? levels.stop.toFixed() : null,
      target1Price: !wantsLive && levels ? levels.target1.toFixed() : null,
      extraTargets: data.extraTargets,
      accountEquity: data.accountEquity,
      legs: scratch
        ? [
            {
              side: 'ENTRY',
              date: data.entryDate,
              executedAt: data.executedAt ? new Date(data.executedAt) : null,
              price: data.entryPrice,
              quantity: data.shares,
              fee: '0',
              rating: null,
              note: null,
            },
          ]
        : [],
    }
    const live: LivePlanInput | null =
      wantsLive && data.plan && accountType
        ? {
            rule: {
              symbol,
              accountType,
              entryDate: data.entryDate,
              entryPrice: data.entryPrice,
              totalShares: data.shares,
              supportLevel: data.plan.supportLevel,
              lotSize: lotSizeFor(assetClass),
              trailingMethod: data.plan.trailingMethod,
              note: data.plan.note,
              target1Override: data.plan.target1Override,
            },
            // Frozen into the plan, whatever the settings say later.
            multiples: { stopAtr: data.plan.stopMultiple, target: data.plan.targetMultiple },
          }
        : null

    const created = await createJournalEntry(userId, input, live)
    return created.ok ? { ok: true, id: created.value, live: live !== null } : created
  })

export const createSetupInline = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => setupSchema.parse(data))
  .handler(async ({ data, context }): Promise<ActionResult<{ id: string }>> => {
    const created = await createSetup(context.userId, data)
    return created.ok ? { ok: true, id: created.value } : created
  })

export const updatePosition = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => updatePositionSchema.parse(data))
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const { id, legs, ...patch } = data
    if (patch.setupId) {
      const setups = await listSetups(context.userId)
      if (!setups.some((setup) => setup.id === patch.setupId)) return refused('That setup no longer exists.')
    }
    if (legs) {
      const replaced = await replaceTypedLegs(
        context.userId,
        id,
        legs.map((leg) => ({
          ...leg,
          executedAt: leg.executedAt ? new Date(leg.executedAt) : null,
        })),
      )
      if (!replaced.ok) return replaced
    }
    const updated = await updateJournalEntry(context.userId, id, patch)
    return updated.ok ? { ok: true } : updated
  })

/**
 * Correct a plan. A live plan goes through the typo-correction path, validated
 * against the *merged* result as it always has been: entry and support moved one
 * at a time could otherwise leave support above entry, which inverts the
 * framework. A static plan stores its levels directly.
 */
export const updatePlan = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => updatePlanSchema.parse(data))
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const { userId } = context
    const entry = await getJournalEntry(userId, data.id)
    if (!entry) return refused('That position no longer exists.')
    const targetsProblem = extraTargetsProblem(data.extraTargets)
    if (targetsProblem) return refused(targetsProblem)

    if (data.live) {
      const plan = (await listExitRules(userId)).find((rule) => rule.journalId === data.id)
      if (!plan) return refused('That plan has been archived.')
      const entryPrice = new Decimal(data.live.entryPrice)
      if (new Decimal(data.live.supportLevel).gte(entryPrice)) return refused('Support must sit below the entry price.')
      if (data.live.target1Override && new Decimal(data.live.target1Override).lte(entryPrice)) {
        return refused('Target 1 must sit above the entry price.')
      }
      await updateExitRule(userId, plan.id, {
        entryPrice: data.live.entryPrice,
        totalShares: data.live.totalShares,
        supportLevel: data.live.supportLevel,
        entryStopAtrMultiple: data.live.stopMultiple,
        entryTargetMultiple: data.live.targetMultiple,
        target1Override: data.live.target1Override,
        trailingMethod: data.live.trailingMethod,
        note: data.live.note,
      })
    }

    const statics = data.static
    if (statics) {
      const detail = await positionDetail(userId, data.id)
      const problem = staticPlanProblem(
        detail?.entryPrice ? new Decimal(detail.entryPrice) : null,
        statics.stopPrice ? new Decimal(statics.stopPrice) : null,
        statics.target1Price ? new Decimal(statics.target1Price) : null,
      )
      if (problem) return refused(problem)
    }
    const updated = await updateJournalEntry(userId, data.id, {
      extraTargets: data.extraTargets,
      ...(statics && { stopPrice: statics.stopPrice, target1Price: statics.target1Price }),
    })
    return updated.ok ? { ok: true } : updated
  })

export const archivePlan = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => positionIdSchema.parse(data))
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const plan = await getExitRule(context.userId, data.id)
    if (!plan) return refused('That plan no longer exists.')
    await archiveExitRule(context.userId, data.id)
    return { ok: true }
  })

export const archivePosition = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => positionIdSchema.parse(data))
  .handler(async ({ data, context }): Promise<ActionResult> => {
    await archiveJournalEntry(context.userId, data.id)
    return { ok: true }
  })

export const deletePosition = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => positionIdSchema.parse(data))
  .handler(async ({ data, context }): Promise<ActionResult> => {
    await deleteJournalEntry(context.userId, data.id)
    return { ok: true }
  })

export const linkPosition = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => linkSchema.parse(data))
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const linked = await linkJournalEntry(context.userId, data.id, data.anchorTradeId, {
      correctPlan: data.correctPlan,
    })
    return linked.ok ? { ok: true } : linked
  })

export const saveLegAnnotation = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => annotationSchema.parse(data))
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const saved = await setLegAnnotation(context.userId, data.journalId, {
      legId: data.legId ?? undefined,
      side: data.side,
      date: data.date,
      firstTradeId: data.firstTradeId,
      rating: data.rating,
      note: data.note,
    })
    return saved.ok ? { ok: true } : saved
  })

export const saveLegTime = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => legTimeSchema.parse(data))
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const saved = await setLegTime(
      context.userId,
      data.journalId,
      data.firstTradeId,
      data.executedAt ? new Date(data.executedAt) : null,
    )
    return saved.ok ? { ok: true } : saved
  })

export const reattachLeg = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => reattachSchema.parse(data))
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const saved = await reattachAnnotation(context.userId, data.legId, {
      firstTradeId: data.firstTradeId,
      side: data.side,
      date: data.date,
    })
    return saved.ok ? { ok: true } : saved
  })

/** "File N existing exit plans" — see `fileExistingPlans`. */
export const fileExitPlans = createServerFn({ method: 'POST' })
  .middleware([authed])
  .handler(({ context }) => fileExistingPlans(context.userId))
