/**
 * Server functions for the Exit Rules screen, which is read-only now that plans
 * are opened and changed in the Playbook. Only its framework settings still save
 * from here.
 *
 * Follows the same contract as `screens.ts`: `Decimal` values cross the wire as
 * exact strings and the client only formats them.
 */
import { createServerFn } from '@tanstack/react-start'
import Decimal from 'decimal.js'
import { z } from 'zod'
import { engineFor } from './engine'
import { evaluateExitRule, exitRuleRow, holdingContext, type ExitRuleRow } from './exitPosition'
import { authed } from './middleware'
import {
  barsFor,
  getAccountEquity,
  getExitSettings,
  listExitRules,
  saveExitSettings as persistSettings,
} from '~/db/exit.service'
import { listJournalEntries } from '~/db/playbook.service'
import { initialStopAtrMultiple, positiveDecimal, targetMultiple, trailingMethod } from '~/lib/exit/planInput'
import type { TrailingMethod } from '~/lib/exit/types'
import { webhookSecretUsable } from '~/lib/exit/webhook'
import { holdingStreaks } from '~/lib/playbook/streaks'

export type { ExitRuleRow } from './exitPosition'

export interface ExitSettingsView {
  targetMultiple: string
  partialExitFraction: string
  initialStopAtrMultiple: string
  trailingAtrMultiple: string
  timeStopDays: number
  trailingMethod: TrailingMethod
  staleTradingDays: number
  /** Prefills the account size on a new Playbook position. */
  accountEquity: string | null
}

export interface ExitScreenData {
  rules: ExitRuleRow[]
  /**
   * Plans that no longer describe a live swing — the position is closed, or was
   * closed and re-entered since. Shown apart rather than mixed into the live
   * ones, whose figures they would otherwise sit beside looking equally current.
   */
  toArchive: ExitRuleRow[]
  settings: ExitSettingsView
  /** False when the secret is unset *or too short*, so the screen can say why no data. */
  webhookConfigured: boolean
}

export const getExitScreen = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(async ({ context }): Promise<ExitScreenData> => {
    const [{ records, trades, engine }, rules, settings, accountEquity, entries] = await Promise.all([
      // The single engine entry point — same pipeline every other screen uses.
      engineFor(context.userId),
      listExitRules(context.userId),
      getExitSettings(context.userId),
      getAccountEquity(context.userId),
      listJournalEntries(context.userId, { includeArchived: true }),
    ])

    // "Today" is resolved per exchange, not from the server's clock: bars are
    // dated in the exchange's zone, and on a UTC host the New York date lags
    // by a session for part of every day.
    const now = new Date()

    // Shares remaining is the engine's truth, not a stored copy - importing
    // the Target 1 sell is what moves a position from "take partial" to
    // "trail", with no separate flag to keep in step.
    const holdings = holdingContext(
      engine.positions,
      trades,
      entries,
      holdingStreaks(records.map((record) => ({ id: record.id, trade: record.trade }))),
    )

    const bars = await barsFor(rules.map((rule) => rule.instrumentId))

    const evaluated = rules.map((rule): ExitRuleRow =>
      exitRuleRow(rule, evaluateExitRule(rule, holdings, bars.get(rule.instrumentId) ?? [], settings, now)),
    )

    const retired = (row: ExitRuleRow): boolean =>
      row.actionKind === 'POSITION_CLOSED' || row.actionKind === 'PLAN_SUPERSEDED'

    return {
      rules: evaluated.filter((row) => !retired(row)),
      toArchive: evaluated.filter(retired),
      settings: {
        targetMultiple: settings.targetMultiple.toFixed(2),
        partialExitFraction: settings.partialExitFraction.toFixed(2),
        initialStopAtrMultiple: settings.initialStopAtrMultiple.toFixed(2),
        trailingAtrMultiple: settings.trailingAtrMultiple.toFixed(2),
        timeStopDays: settings.timeStopDays,
        trailingMethod: settings.trailingMethod,
        staleTradingDays: settings.staleTradingDays,
        accountEquity: accountEquity?.toFixed() ?? null,
      },
      // The route's own predicate, not a truthiness check: a secret shorter than
      // the minimum 503s every payload, and reporting that as configured left
      // the screen silent about the one thing wrong with it.
      webhookConfigured: webhookSecretUsable(process.env.TRADINGVIEW_WEBHOOK_SECRET),
    }
  })

/**
 * Ranges match the framework's own stated bounds rather than being arbitrary.
 * Outside them the rule set stops behaving the way it was validated to behave.
 */
const settingsSchema = z.object({
  targetMultiple,
  partialExitFraction: positiveDecimal('partial exit fraction').refine((raw) => {
    const value = new Decimal(raw)
    return value.gte('0.1') && value.lte('1.0')
  }, 'partial exit must be between 10% and 100%'),
  initialStopAtrMultiple,
  trailingAtrMultiple: positiveDecimal('trailing ATR multiple').refine((raw) => {
    const value = new Decimal(raw)
    return value.gte('1') && value.lte('10')
  }, 'trailing multiple must be between 1 and 10'),
  timeStopDays: z.number().int().min(1).max(120),
  trailingMethod,
  staleTradingDays: z.number().int().min(1).max(30),
  accountEquity: positiveDecimal('account size').nullable(),
})

export const saveExitSettings = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => settingsSchema.parse(data))
  .handler(async ({ data, context }) => {
    await persistSettings(context.userId, data)
    return { ok: true as const }
  })
