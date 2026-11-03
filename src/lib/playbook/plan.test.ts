import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { planLevels, type PlanLevels } from './plan'
import { symbolProblem } from './validate'

const input = {
  entryPrice: '1000',
  shares: '100',
  supportLevel: '950',
  stopMultiple: '2',
  targetMultiple: '2',
  target1Override: null,
  extraTargets: [],
  accountEquity: '1000000',
}

const levels = (result: PlanLevels | string): PlanLevels => {
  if (typeof result === 'string') throw new Error(result)
  return result
}

describe('planLevels', () => {
  it('falls back to support alone until an entry-date bar exists', () => {
    const plan = levels(planLevels(input, null))
    expect(plan.stop.toFixed()).toBe('950')
    expect(plan.fromSupportOnly).toBe(true)
    expect(plan.target1.toFixed()).toBe('1100')
  })

  it('takes the lower of support and the ATR stop, as a live plan would', () => {
    const plan = levels(planLevels(input, new Decimal(40)))
    expect(plan.stop.toFixed()).toBe('920')
    expect(plan.riskPerShare.toFixed()).toBe('80')
    expect(plan.fromSupportOnly).toBe(false)
  })

  it('states risk against the account', () => {
    const plan = levels(planLevels(input, null))
    expect(plan.riskAmount.toFixed()).toBe('5000')
    expect(plan.riskPct?.toFixed(3)).toBe('0.005')
    expect(plan.sizePct?.toFixed(1)).toBe('0.1')
    expect(plan.riskRating).toBe(10)
  })

  it('has no risk % without an account size', () => {
    const plan = levels(planLevels({ ...input, accountEquity: null }, null))
    expect(plan.riskPct).toBeNull()
    expect(plan.riskRating).toBeNull()
  })

  it('uses a manual Target 1, and states it in R', () => {
    const plan = levels(planLevels({ ...input, target1Override: '1150' }, null))
    expect(plan.target1.toFixed()).toBe('1150')
    expect(plan.plannedR.toFixed()).toBe('3')
  })

  it.each([
    [{ supportLevel: '1000' }, 'Support must sit below the entry price.'],
    [{ target1Override: '1000' }, 'Target 1 must sit above the entry price.'],
    [{ supportLevel: 'abc' }, 'Support must be a number.'],
    [{ shares: '0' }, 'Shares must be above zero.'],
    [{ extraTargets: [{ price: '1200', fraction: '1.5' }] }, 'Each target sells a fraction between 0 and 1.'],
  ])('refuses %j', (over, message) => {
    expect(planLevels({ ...input, ...over }, null)).toBe(message)
  })
})

describe('symbolProblem', () => {
  it('takes the forms an import will use', () => {
    expect(symbolProblem('7203', 'JP')).toBeNull()
    expect(symbolProblem('130A', 'JP')).toBeNull()
    expect(symbolProblem('AAPL', 'US')).toBeNull()
    expect(symbolProblem('BRK.B', 'US')).toBeNull()
  })

  it('refuses what no later export could match', () => {
    expect(symbolProblem('Toyota', 'JP')).not.toBeNull()
    expect(symbolProblem('72030', 'JP')).not.toBeNull()
    expect(symbolProblem('7203', 'US')).not.toBeNull()
  })
})
