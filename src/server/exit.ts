/**
 * Server functions for the exit framework's settings, on the Settings screen.
 * Plans themselves are read and changed through `playbook.ts`.
 *
 * Follows the same contract as `screens.ts`: `Decimal` values cross the wire as
 * exact strings and the client only formats them.
 */
import { createServerFn } from '@tanstack/react-start'
import Decimal from 'decimal.js'
import { z } from 'zod'
import { authed } from './middleware'
import { getAccountEquity, getExitSettings, saveExitSettings as persistSettings } from '~/db/exit.service'
import { initialStopAtrMultiple, positiveDecimal, targetMultiple, trailingMethod } from '~/lib/exit/planInput'
import type { TrailingMethod } from '~/lib/exit/types'
import { webhookSecretUsable } from '~/lib/exit/webhook'

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

export interface ExitSettingsData {
  settings: ExitSettingsView
  /** False when the secret is unset *or too short*, so Settings can say why no data. */
  webhookConfigured: boolean
}

export const getFrameworkSettings = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(async ({ context }): Promise<ExitSettingsData> => {
    const [settings, accountEquity] = await Promise.all([
      getExitSettings(context.userId),
      getAccountEquity(context.userId),
    ])
    return {
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
