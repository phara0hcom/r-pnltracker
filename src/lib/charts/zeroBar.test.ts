import { describe, expect, it } from 'vitest'
import { zeroBarGeometry } from './zeroBar'

/** Right-hand edge of the positive fill, as a percentage of the track. */
const posEnd = (g: ReturnType<typeof zeroBarGeometry>) => g.zeroPct + g.posPct
/** Left-hand edge of the negative fill: it is anchored to the zero line and grows left. */
const negStart = (g: ReturnType<typeof zeroBarGeometry>) => g.zeroPct - g.negPct

describe('zeroBarGeometry', () => {
  it('keeps every bar inside the track, gains-heavy', () => {
    const [maxPos, maxNeg] = [101_700, 86_000]
    for (const value of [maxPos, 94_000, 1, -1, -50_000, -maxNeg]) {
      const g = zeroBarGeometry(value, maxPos, maxNeg)
      expect(posEnd(g)).toBeLessThanOrEqual(100.000001)
      expect(negStart(g)).toBeGreaterThanOrEqual(-0.000001)
    }
  })

  it('keeps every bar inside the track, losses-heavy', () => {
    const [maxPos, maxNeg] = [86_000, 101_700]
    for (const value of [maxPos, 40_000, -60_000, -maxNeg]) {
      const g = zeroBarGeometry(value, maxPos, maxNeg)
      expect(posEnd(g)).toBeLessThanOrEqual(100.000001)
      expect(negStart(g)).toBeGreaterThanOrEqual(-0.000001)
    }
  })

  it('spends the full side on the extreme of that side', () => {
    const g = zeroBarGeometry(101_700, 101_700, 86_000)
    expect(posEnd(g)).toBeCloseTo(100, 6)

    const loss = zeroBarGeometry(-86_000, 101_700, 86_000)
    expect(negStart(loss)).toBeCloseTo(0, 6)
  })

  /*
   * The reason the zero line is placed by the *loss* share. Equal yen must draw
   * equal length whichever side it falls on; scaling each side by its own
   * extent is what makes that true even when the extents are lopsided.
   */
  it('draws equal magnitudes at equal length', () => {
    const g = zeroBarGeometry(50_000, 101_700, 86_000)
    const loss = zeroBarGeometry(-50_000, 101_700, 86_000)
    expect(g.posPct).toBeCloseTo(loss.negPct, 6)
  })

  it('puts the zero line at the share the losses occupy', () => {
    // Losses are a quarter of the range, so a quarter of the track sits left of zero.
    const g = zeroBarGeometry(0, 300, 100)
    expect(g.zeroPct).toBeCloseTo(25, 6)
  })

  it('clamps a value beyond its declared extent rather than overflowing', () => {
    const over = zeroBarGeometry(500, 100, 100)
    expect(posEnd(over)).toBeCloseTo(100, 6)

    const under = zeroBarGeometry(-500, 100, 100)
    expect(negStart(under)).toBeCloseTo(0, 6)
  })

  it('renders no fill for a zero value', () => {
    const g = zeroBarGeometry(0, 100, 100)
    expect(g.posPct).toBe(0)
    expect(g.negPct).toBe(0)
  })

  it('centres the line when there is no range at all', () => {
    expect(zeroBarGeometry(0, 0, 0)).toEqual({ zeroPct: 50, posPct: 0, negPct: 0 })
  })

  it('treats a one-sided range as one-sided', () => {
    // Only gains: the line sits hard left and every bar grows right.
    const gains = zeroBarGeometry(50, 100, 0)
    expect(gains.zeroPct).toBeCloseTo(0, 6)
    expect(gains.posPct).toBeCloseTo(50, 6)

    // Only losses: the line sits hard right.
    const losses = zeroBarGeometry(-50, 0, 100)
    expect(losses.zeroPct).toBeCloseTo(100, 6)
    expect(losses.negPct).toBeCloseTo(50, 6)
  })

  it('ignores a negative extent from an empty reduce', () => {
    const g = zeroBarGeometry(50, 100, -5)
    expect(g.zeroPct).toBeCloseTo(0, 6)
    expect(posEnd(g)).toBeLessThanOrEqual(100.000001)
  })
})
