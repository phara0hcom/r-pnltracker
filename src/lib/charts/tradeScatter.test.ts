import { describe, expect, it } from 'vitest'
import {
  PLOT_INSET_PCT,
  bubbleRadius,
  dayParts,
  monthWindow,
  percentTicks,
  returnDomain,
  scatterGeometry,
  weekWindow,
  windowsBack,
  yPctFor,
} from './tradeScatter'

describe('monthWindow', () => {
  it('covers the whole calendar month the anchor falls in', () => {
    const august = monthWindow('2026-08-14', 0)
    expect(august.start).toBe('2026-08-01')
    expect(august.end).toBe('2026-08-31')
    expect(august.days).toHaveLength(31)
    expect(august.label).toBe('Aug 2026')
  })

  it('knows the short months, February included', () => {
    expect(monthWindow('2026-02-10', 0).days).toHaveLength(28)
    expect(monthWindow('2024-02-10', 0).days).toHaveLength(29)
    expect(monthWindow('2026-04-10', 0).days).toHaveLength(30)
  })

  /* The whole reason the month arithmetic goes through `Date.UTC`. */
  it('rolls the year back rather than producing a month zero', () => {
    const window = monthWindow('2026-02-14', 3)
    expect(window.start).toBe('2025-11-01')
    expect(window.end).toBe('2025-11-30')
    expect(window.label).toBe('Nov 2025')
  })

  it('anchors to the month, not to the day within it', () => {
    expect(monthWindow('2026-08-01', 1).start).toBe(monthWindow('2026-08-31', 1).start)
  })
})

describe('weekWindow', () => {
  it('starts on Monday and runs seven days', () => {
    // 2026-08-14 is a Friday.
    const week = weekWindow('2026-08-14', 0)
    expect(week.start).toBe('2026-08-10')
    expect(week.end).toBe('2026-08-16')
    expect(week.days).toHaveLength(7)
    expect(dayParts(week.start).weekday).toBe('Mon')
  })

  it('treats Sunday as the end of its week, not the start of the next', () => {
    expect(weekWindow('2026-08-16', 0).start).toBe('2026-08-10')
  })

  it('names the month once inside a month and twice across one', () => {
    expect(weekWindow('2026-08-14', 0).label).toBe('Aug 10 – 16')
    // 2026-08-31 is a Monday, so this week runs into September.
    expect(weekWindow('2026-08-31', 0).label).toBe('Aug 31 – Sep 6')
  })

  it('steps back a whole week at a time', () => {
    expect(weekWindow('2026-08-14', 2).start).toBe('2026-07-27')
  })
})

describe('windowsBack', () => {
  it('counts months between the oldest close and the anchor', () => {
    expect(windowsBack('month', '2025-11-28', '2026-02-03')).toBe(3)
    expect(windowsBack('month', '2026-02-01', '2026-02-28')).toBe(0)
  })

  it('counts weeks by their Mondays, so mid-week dates do not round oddly', () => {
    expect(windowsBack('week', '2026-08-01', '2026-08-14')).toBe(2)
    expect(windowsBack('week', '2026-08-10', '2026-08-16')).toBe(0)
  })

  /* A close dated after the anchor cannot page forward; the nav clamps at 0. */
  it('never goes negative', () => {
    expect(windowsBack('month', '2026-08-01', '2026-01-01')).toBe(0)
    expect(windowsBack('week', '2026-08-01', '2026-01-01')).toBe(0)
  })
})

describe('returnDomain', () => {
  it('puts the zero line at the foot of the plot when nothing lost money', () => {
    const domain = returnDomain([0.04, 0.12, 0.2])
    expect(domain.min).toBe(0)
    expect(domain.zeroPct).toBeCloseTo(100 - PLOT_INSET_PCT, 6)
  })

  it('puts it at the head when nothing made money', () => {
    const domain = returnDomain([-0.04, -0.12])
    expect(domain.max).toBe(0)
    expect(domain.zeroPct).toBeCloseTo(PLOT_INSET_PCT, 6)
  })

  it('contains every return it was given', () => {
    const returns = [-0.37, -0.02, 0.008, 0.41, 1.9]
    const domain = returnDomain(returns)
    for (const value of returns) {
      expect(value).toBeGreaterThanOrEqual(domain.min)
      expect(value).toBeLessThanOrEqual(domain.max)
    }
  })

  /*
   * The bug this guards: `percentTicks` used to derive its own step from the
   * already-rounded span, which came out 0.25 where the bounds had been built
   * on 0.2. The top gridline then landed short of the top of the plot with a
   * band of dead space above it.
   */
  it('puts a gridline on each of its own bounds', () => {
    const domain = returnDomain([-0.27, 0.41])
    expect(domain.max / domain.step).toBeCloseTo(Math.round(domain.max / domain.step), 9)
    expect(domain.min / domain.step).toBeCloseTo(Math.round(domain.min / domain.step), 9)

    const tops = percentTicks(domain).map((tick) => tick.topPct)
    expect(Math.min(...tops)).toBeCloseTo(PLOT_INSET_PCT, 6)
    expect(Math.max(...tops)).toBeCloseTo(100 - PLOT_INSET_PCT, 6)
  })

  it('falls back to a nominal span when there is nothing to scale', () => {
    for (const returns of [[], [0], [0, 0, 0]]) {
      const domain = returnDomain(returns)
      expect(domain.max).toBeGreaterThan(domain.min)
      expect(domain.zeroPct).toBeGreaterThan(0)
      expect(domain.zeroPct).toBeLessThan(100)
    }
  })
})

describe('percentTicks', () => {
  it('lands on round percentages rather than the raw range over a tick count', () => {
    for (const tick of percentTicks(returnDomain([-0.183, 0.437]))) {
      // Any tick should survive a round trip through two decimal places of a
      // percentage — that is exactly what the axis label prints.
      expect(tick.value * 100).toBeCloseTo(Number((tick.value * 100).toFixed(2)), 9)
    }
  })

  it('leaves zero to the baseline', () => {
    const ticks = percentTicks(returnDomain([-0.2, 0.4]))
    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks.some((tick) => tick.value === 0)).toBe(false)
  })

  it('keeps every gridline inside the plot', () => {
    const domain = returnDomain([-0.2, 0.4])
    for (const tick of percentTicks(domain)) {
      expect(tick.topPct).toBeGreaterThanOrEqual(0)
      expect(tick.topPct).toBeLessThanOrEqual(100)
    }
  })
})

describe('bubbleRadius', () => {
  /*
   * The reason radius is a square root. Four times the yen has to draw four
   * times the *area*, which is twice the radius — not four times it.
   */
  it('scales area with the amount, not radius', () => {
    const quarter = bubbleRadius(25_000, 100_000, 0, 20)
    const full = bubbleRadius(100_000, 100_000, 0, 20)
    expect(full / quarter).toBeCloseTo(2, 6)
  })

  it('gives the smallest close a hit target', () => {
    expect(bubbleRadius(1, 1_000_000, 4, 20)).toBeGreaterThanOrEqual(4)
    expect(bubbleRadius(0, 1_000_000, 4, 20)).toBe(4)
  })

  it('sizes losses by magnitude, so a loss and a win of equal size match', () => {
    expect(bubbleRadius(-80_000, 100_000, 4, 20)).toBe(bubbleRadius(80_000, 100_000, 4, 20))
  })

  it('clamps a value past the declared maximum instead of overflowing', () => {
    expect(bubbleRadius(500_000, 100_000, 4, 20)).toBe(20)
    expect(bubbleRadius(5, 0, 4, 20)).toBe(4)
  })
})

describe('scatterGeometry', () => {
  const days = weekWindow('2026-08-14', 0).days
  const domain = returnDomain([-0.2, 0.4])
  const options = { days, domain, maxMagnitude: 100_000, minRadius: 4, maxRadius: 20 }

  const trade = (date: string, returnPct: number, realizedJpy: number) => ({
    date,
    returnPct,
    realizedJpy,
  })

  it('places a lone close at the centre of its day column', () => {
    const [mark] = scatterGeometry([trade('2026-08-12', 0.1, 10_000)], options)
    // Wednesday is index 2 of seven, so its centre is 2.5 columns across.
    expect(mark?.xPct).toBeCloseTo((2.5 / 7) * 100, 6)
    expect(mark?.yPct).toBeCloseTo(yPctFor(0.1, domain), 6)
  })

  it('drops closes outside the window rather than folding them onto an edge', () => {
    const marks = scatterGeometry(
      [trade('2026-08-03', 0.1, 10_000), trade('2026-08-12', 0.1, 10_000)],
      options,
    )
    expect(marks).toHaveLength(1)
    expect(marks[0]?.trade.date).toBe('2026-08-12')
  })

  /*
   * Same-day round trips are real in this data — the engine's own ordering
   * comment cites one. Without the fan-out the second close draws exactly on
   * top of the first and can never be hovered.
   */
  it('separates closes sharing a day', () => {
    const marks = scatterGeometry(
      [
        trade('2026-08-12', 0.1, 10_000),
        trade('2026-08-12', 0.1, 10_000),
        trade('2026-08-12', 0.1, 10_000),
      ],
      options,
    )
    const xs = marks.map((mark) => mark.xPct)
    expect(new Set(xs).size).toBe(3)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })

  it('keeps the fan-out inside its own day column', () => {
    const columnPct = 100 / days.length
    const marks = scatterGeometry(
      Array.from({ length: 6 }, () => trade('2026-08-12', 0.1, 10_000)),
      options,
    )
    const centre = 2.5 * columnPct
    for (const mark of marks) {
      expect(Math.abs(mark.xPct - centre)).toBeLessThan(columnPct / 2)
    }
  })

  it('preserves input order, which becomes tab order', () => {
    const marks = scatterGeometry(
      [
        trade('2026-08-14', 0.3, 10_000),
        trade('2026-08-10', -0.1, 10_000),
        trade('2026-08-12', 0.1, 10_000),
      ],
      options,
    )
    expect(marks.map((mark) => mark.trade.date)).toEqual(['2026-08-14', '2026-08-10', '2026-08-12'])
  })

  it('has nowhere to draw without days', () => {
    expect(scatterGeometry([trade('2026-08-12', 0.1, 10_000)], { ...options, days: [] })).toEqual([])
  })
})

describe('dayParts', () => {
  it('marks the weekend, when the market is shut and the column is always empty', () => {
    expect(dayParts('2026-08-15').isWeekend).toBe(true)
    expect(dayParts('2026-08-16').isWeekend).toBe(true)
    expect(dayParts('2026-08-14').isWeekend).toBe(false)
  })

  it('reads the calendar day, not a local-time shifted one', () => {
    expect(dayParts('2026-08-01')).toMatchObject({ day: 1, weekday: 'Sat' })
    expect(dayParts('2026-12-31')).toMatchObject({ day: 31, weekday: 'Thu' })
  })
})
