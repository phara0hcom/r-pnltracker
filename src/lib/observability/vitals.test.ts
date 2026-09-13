import { describe, expect, it } from 'vitest'
import { isPoorVital, POOR_VITALS } from './vitals'

describe('isPoorVital', () => {
  it('reports a vital past the poor boundary', () => {
    expect(isPoorVital('LCP', 4001)).toBe(true)
    expect(isPoorVital('INP', 750)).toBe(true)
    expect(isPoorVital('CLS', 0.3)).toBe(true)
  })

  it('stays quiet at or below the boundary', () => {
    // Exactly on the boundary is still "needs improvement", not "poor" — and a
    // page that merely needs improvement is already in Speed Insights.
    expect(isPoorVital('LCP', POOR_VITALS.LCP)).toBe(false)
    expect(isPoorVital('INP', 120)).toBe(false)
    expect(isPoorVital('CLS', 0)).toBe(false)
  })
})
