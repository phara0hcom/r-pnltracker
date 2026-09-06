/**
 * A plan fixture for component tests.
 *
 * The default is the case the Exit Rules screen exists for — a stopped-out
 * position, urgent, with a lapsed feed — so a test that cares about none of
 * that still renders something representative. Override only the fields under
 * test, and the reason a test exists stays visible in its own call.
 */
import type { ExitRuleRow } from '~/server/exit'

export function makePlan(overrides: Partial<ExitRuleRow> = {}): ExitRuleRow {
  return {
    id: 'r1',
    symbol: '7203',
    name: 'トヨタ自動車',
    assetClass: 'JP_EQUITY',
    accountType: 'SPECIFIC',
    currency: 'JPY',
    entryDate: '2026-06-03',
    entryPrice: '2996',
    totalShares: '300',
    sharesRemaining: '300',
    supportLevel: '2700',
    entryAtr: '95',
    lotSize: 100,
    trailingMethod: 'ATR',
    trailingMethodOverride: null,
    note: 'Support at ¥2,700 from the June base.',
    initialStop: '2710',
    riskPerShare: '286',
    target1: '3180',
    partialExitShares: '200',
    target1Hit: false,
    target1HitDate: null,
    partialTaken: false,
    highestClose: '3050',
    trailingStop: null,
    trailingActive: false,
    currentStop: '2710',
    currentPrice: '2684',
    lastBarDate: '2026-09-04',
    rsi14: '31.4',
    macdHist: '-18.2',
    atr14: '88',
    daysHeld: 63,
    tradingDaysHeld: 42,
    timeStopFlag: false,
    stale: true,
    staleTradingDays: 6,
    stopFromSupportOnly: false,
    unrealizedPerShare: '-280',
    unrealizedTotal: '-84000',
    actionKind: 'STOPPED_OUT',
    actionMessage: 'Stopped out — close ¥2,684 is at or below the ¥2,710 stop.',
    actionSeverity: 'urgent',
    ...overrides,
  }
}
