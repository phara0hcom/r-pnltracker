/**
 * Server functions for the Exit Rules screen.
 *
 * Follows the same contract as `screens.ts`: `Decimal` values cross the wire as
 * exact strings and the client only formats them. The suggested action arrives
 * as finished prose, assembled in `lib/exit/rules.ts`, so the UI never has to
 * reason about which branch of the framework a position is in.
 */
import { createServerFn } from '@tanstack/react-start'
import Decimal from 'decimal.js'
import { z } from 'zod'
import { authed } from './middleware'
import {
  archiveExitRule as archiveRule,
  barsFor,
  createExitRule as createRule,
  getExitSettings,
  listExitRules,
  saveExitSettings as persistSettings,
  updateExitRule as patchRule,
} from '~/db/exit.service'
import { listTrades } from '~/db/trades.service'
import type { AccountType, AssetClass } from '~/lib/domain/types'
import { openEntryStreaks, streakFor } from '~/lib/exit/entry'
import { assess } from '~/lib/exit/rules'
import { TRAILING_METHODS, type ExitActionKind, type TrailingMethod } from '~/lib/exit/types'
import { todayLocal } from '~/lib/localDate'
import { runEngine } from '~/lib/pnl/engine'

/** Only listed equities get exit rules — no provider feeds a fund's 基準価額. */
const ELIGIBLE_CLASSES: readonly AssetClass[] = ['JP_EQUITY', 'US_EQUITY']

/** 東証 trades in 100-share board lots; US shares are indivisible by one. */
const lotSizeFor = (assetClass: AssetClass): number => (assetClass === 'US_EQUITY' ? 1 : 100)

const currencyFor = (assetClass: AssetClass): 'JPY' | 'USD' =>
  assetClass === 'US_EQUITY' ? 'USD' : 'JPY'

/** Per-share prices. Two places is enough for both currencies, and exact for both. */
const price = (value: Decimal | null): string | null => value?.toFixed(2) ?? null
const shares = (value: Decimal): string => value.toFixed()

/** Engine pools are keyed (symbol x accountType); so is an exit plan over one. */
const poolKey = (symbol: string, account: AccountType): string => `${symbol} ${account}`

export interface ExitRuleRow {
  id: string
  symbol: string
  name: string
  assetClass: AssetClass
  accountType: AccountType
  currency: 'JPY' | 'USD'

  entryDate: string
  entryPrice: string
  totalShares: string
  sharesRemaining: string
  supportLevel: string
  entryAtr: string | null
  lotSize: number
  /** After the per-position override is resolved against the global default. */
  trailingMethod: TrailingMethod
  trailingMethodOverride: TrailingMethod | null
  note: string | null

  initialStop: string
  riskPerShare: string
  target1: string
  partialExitShares: string
  target1Hit: boolean
  target1HitDate: string | null
  partialTaken: boolean
  highestClose: string | null
  trailingStop: string | null
  trailingActive: boolean
  currentStop: string

  currentPrice: string | null
  lastBarDate: string | null
  rsi14: string | null
  macdHist: string | null
  atr14: string | null

  daysHeld: number
  tradingDaysHeld: number
  timeStopFlag: boolean
  stale: boolean
  staleTradingDays: number
  /** True when no entry-date bar existed and support alone set the stop. */
  stopFromSupportOnly: boolean

  unrealizedPerShare: string | null
  unrealizedTotal: string | null

  actionKind: ExitActionKind
  actionMessage: string
  actionSeverity: 'urgent' | 'attention' | 'neutral'
}

/** An open holding with no live plan yet, carrying prefill for the form. */
export interface EligibleHolding {
  symbol: string
  name: string
  assetClass: AssetClass
  accountType: AccountType
  currency: 'JPY' | 'USD'
  quantity: string
  /** Start of the current holding streak - see `lib/exit/entry.ts`. */
  entryDate: string
  entryPrice: string
  lotSize: number
}

export interface ExitSettingsView {
  targetMultiple: string
  partialExitFraction: string
  initialStopAtrMultiple: string
  trailingAtrMultiple: string
  timeStopDays: number
  trailingMethod: TrailingMethod
  staleTradingDays: number
}

export interface ExitScreenData {
  rules: ExitRuleRow[]
  /** Plans whose position is gone - shown apart, not mixed into live ones. */
  closed: ExitRuleRow[]
  eligible: EligibleHolding[]
  settings: ExitSettingsView
  /** False when the webhook secret is unset, so the screen can say why no data. */
  webhookConfigured: boolean
}

export const getExitScreen = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(async ({ context }): Promise<ExitScreenData> => {
    const [records, rules, settings] = await Promise.all([
      listTrades(context.userId),
      listExitRules(context.userId),
      getExitSettings(context.userId),
    ])

    const trades = records.map((record) => record.trade)
    const { positions } = runEngine(trades)
    const streaks = openEntryStreaks(trades)
    const today = todayLocal()

    const heldBy = new Map(
      positions.map((position) => [
        poolKey(position.symbol, position.accountType),
        position.quantity,
      ]),
    )

    const bars = await barsFor(rules.map((rule) => rule.instrumentId))

    const evaluated = rules.map((rule): ExitRuleRow => {
      // Shares remaining is the engine's truth, not a stored copy - importing
      // the Target 1 sell is what moves a position from "take partial" to
      // "trail", with no separate flag to keep in step.
      const remaining = heldBy.get(poolKey(rule.symbol, rule.accountType)) ?? new Decimal(0)

      const result = assess(
        {
          symbol: rule.symbol,
          name: rule.name,
          assetClass: rule.assetClass,
          accountType: rule.accountType,
          entryDate: rule.entryDate,
          entryPrice: rule.entryPrice,
          totalShares: rule.totalShares,
          sharesRemaining: remaining,
          supportLevel: rule.supportLevel,
          entryAtr: rule.entryAtr,
          lotSize: rule.lotSize,
          trailingMethod: rule.trailingMethod,
        },
        bars.get(rule.instrumentId) ?? [],
        settings,
        today,
      )

      return {
        id: rule.id,
        symbol: rule.symbol,
        name: rule.name,
        assetClass: rule.assetClass,
        accountType: rule.accountType,
        currency: currencyFor(rule.assetClass),

        entryDate: rule.entryDate,
        entryPrice: rule.entryPrice.toFixed(2),
        totalShares: shares(rule.totalShares),
        sharesRemaining: shares(remaining),
        supportLevel: rule.supportLevel.toFixed(2),
        entryAtr: price(rule.entryAtr),
        lotSize: rule.lotSize,
        trailingMethod: result.trailingMethod,
        trailingMethodOverride: rule.trailingMethod,
        note: rule.note,

        initialStop: result.initialStop.toFixed(2),
        riskPerShare: result.riskPerShare.toFixed(2),
        target1: result.target1.toFixed(2),
        partialExitShares: shares(result.partialExitShares),
        target1Hit: result.target1Hit,
        target1HitDate: result.target1HitDate,
        partialTaken: result.partialTaken,
        highestClose: price(result.highestClose),
        trailingStop: price(result.trailingStop),
        trailingActive: result.trailingActive,
        currentStop: result.currentStop.toFixed(2),

        currentPrice: price(result.latestBar?.close ?? null),
        lastBarDate: result.latestBar?.tradingDay ?? null,
        rsi14: result.latestBar?.rsi14.toFixed(1) ?? null,
        macdHist: result.latestBar?.macdHist.toFixed(4) ?? null,
        atr14: price(result.latestBar?.atr14 ?? null),

        daysHeld: result.daysHeld,
        tradingDaysHeld: result.tradingDaysHeld,
        timeStopFlag: result.timeStopFlag,
        stale: result.stale,
        staleTradingDays: result.staleTradingDays,
        stopFromSupportOnly: result.stopFromSupportOnly,

        unrealizedPerShare: price(result.unrealizedPerShare),
        unrealizedTotal:
          result.unrealizedPerShare === null
            ? null
            : result.unrealizedPerShare.mul(remaining).toFixed(0),

        actionKind: result.action.kind,
        actionMessage: result.action.message,
        actionSeverity: result.action.severity,
      }
    })

    const ruledPools = new Set(rules.map((rule) => poolKey(rule.symbol, rule.accountType)))

    const eligible: EligibleHolding[] = positions
      .filter((position) => ELIGIBLE_CLASSES.includes(position.assetClass))
      .filter((position) => !ruledPools.has(poolKey(position.symbol, position.accountType)))
      .map((position) => {
        const streak = streakFor(streaks, position.symbol, position.accountType)
        return {
          symbol: position.symbol,
          name: position.name,
          assetClass: position.assetClass,
          accountType: position.accountType,
          currency: currencyFor(position.assetClass),
          quantity: shares(position.quantity),
          // Falls back to the pool average when no streak could be identified,
          // which only happens for a position whose opening trades predate the
          // imported history.
          entryDate: streak?.entryDate ?? today,
          entryPrice: (streak?.entryPrice ?? position.avgPriceNative).toFixed(2),
          lotSize: lotSizeFor(position.assetClass),
        }
      })
      .sort((left, right) => left.symbol.localeCompare(right.symbol))

    return {
      rules: evaluated.filter((row) => row.actionKind !== 'POSITION_CLOSED'),
      closed: evaluated.filter((row) => row.actionKind === 'POSITION_CLOSED'),
      eligible,
      settings: {
        targetMultiple: settings.targetMultiple.toFixed(2),
        partialExitFraction: settings.partialExitFraction.toFixed(2),
        initialStopAtrMultiple: settings.initialStopAtrMultiple.toFixed(2),
        trailingAtrMultiple: settings.trailingAtrMultiple.toFixed(2),
        timeStopDays: settings.timeStopDays,
        trailingMethod: settings.trailingMethod,
        staleTradingDays: settings.staleTradingDays,
      },
      webhookConfigured: Boolean(process.env.TRADINGVIEW_WEBHOOK_SECRET),
    }
  })

/**
 * A positive decimal, as text.
 *
 * Validated rather than passed through because these land in `numeric` columns:
 * anything non-numeric would surface as a 500 from Postgres instead of a message
 * against the field that caused it.
 */
const positiveDecimal = (label: string) =>
  z
    .string()
    .trim()
    .min(1)
    .refine((raw) => {
      try {
        const parsed = new Decimal(raw)
        return parsed.isFinite() && parsed.gt(0)
      } catch {
        return false
      }
    }, `${label} must be a positive number`)

const trailingMethod = z.enum(TRAILING_METHODS as [TrailingMethod, ...TrailingMethod[]])

const createSchema = z
  .object({
    symbol: z.string().trim().min(1).max(128),
    accountType: z.enum(['SPECIFIC', 'NISA_OLD', 'NISA_GROWTH', 'NISA_TSUMITATE']),
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'entry date must be YYYY-MM-DD'),
    entryPrice: positiveDecimal('entry price'),
    totalShares: positiveDecimal('total shares'),
    supportLevel: positiveDecimal('support level'),
    lotSize: z.number().int().positive().max(10_000),
    trailingMethod: trailingMethod.nullable(),
    note: z.string().trim().max(500).nullable(),
  })
  .refine((data) => new Decimal(data.supportLevel).lt(data.entryPrice), {
    // A support level at or above entry makes R zero or negative, which puts
    // Target 1 at or below the entry price and inverts the whole framework.
    message: 'support level must be below the entry price',
    path: ['supportLevel'],
  })

export const createExitRule = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    const id = await createRule(context.userId, data)
    return { ok: true as const, id }
  })

const updateSchema = z
  .object({
    id: z.string().min(1),
    entryPrice: positiveDecimal('entry price').optional(),
    totalShares: positiveDecimal('total shares').optional(),
    supportLevel: positiveDecimal('support level').optional(),
    trailingMethod: trailingMethod.nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine(
    (data) =>
      data.supportLevel === undefined ||
      data.entryPrice === undefined ||
      new Decimal(data.supportLevel).lt(data.entryPrice),
    { message: 'support level must be below the entry price', path: ['supportLevel'] },
  )

export const updateExitRule = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data
    await patchRule(context.userId, id, patch)
    return { ok: true as const }
  })

export const archiveExitRule = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => z.object({ id: z.string().min(1) }).parse(data))
  .handler(async ({ data, context }) => {
    await archiveRule(context.userId, data.id)
    return { ok: true as const }
  })

/**
 * Ranges match the framework's own stated bounds rather than being arbitrary.
 * Outside them the rule set stops behaving the way it was validated to behave.
 */
const settingsSchema = z.object({
  targetMultiple: positiveDecimal('target multiple').refine((raw) => {
    const value = new Decimal(raw)
    return value.gte('1.0') && value.lte('3.0')
  }, 'target multiple must be between 1.0 and 3.0'),
  partialExitFraction: positiveDecimal('partial exit fraction').refine((raw) => {
    const value = new Decimal(raw)
    return value.gte('0.1') && value.lte('1.0')
  }, 'partial exit must be between 10% and 100%'),
  initialStopAtrMultiple: positiveDecimal('initial stop ATR multiple').refine((raw) => {
    const value = new Decimal(raw)
    return value.gte('0.5') && value.lte('5')
  }, 'initial stop multiple must be between 0.5 and 5'),
  trailingAtrMultiple: positiveDecimal('trailing ATR multiple').refine((raw) => {
    const value = new Decimal(raw)
    return value.gte('1') && value.lte('10')
  }, 'trailing multiple must be between 1 and 10'),
  timeStopDays: z.number().int().min(1).max(120),
  trailingMethod,
  staleTradingDays: z.number().int().min(1).max(30),
})

export const saveExitSettings = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => settingsSchema.parse(data))
  .handler(async ({ data, context }) => {
    await persistSettings(context.userId, data)
    return { ok: true as const }
  })
