import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { assess, initialStopFor, roundDownToLot } from './rules'
import { DEFAULT_EXIT_SETTINGS, type ExitRulePosition, type ExitSettings, type FeedBar } from './types'

const d = (value: string | number) => new Decimal(value)

const settings = (overrides: Partial<ExitSettings> = {}): ExitSettings => ({
  targetMultiple: d(DEFAULT_EXIT_SETTINGS.targetMultiple),
  partialExitFraction: d(DEFAULT_EXIT_SETTINGS.partialExitFraction),
  initialStopAtrMultiple: d(DEFAULT_EXIT_SETTINGS.initialStopAtrMultiple),
  trailingAtrMultiple: d(DEFAULT_EXIT_SETTINGS.trailingAtrMultiple),
  timeStopDays: DEFAULT_EXIT_SETTINGS.timeStopDays,
  trailingMethod: DEFAULT_EXIT_SETTINGS.trailingMethod,
  staleTradingDays: DEFAULT_EXIT_SETTINGS.staleTradingDays,
  ...overrides,
})

/** Entry at ¥1,000 with support ¥950 and ATR 20 → stop ¥950, R ¥50, Target 1 ¥1,075. */
const position = (overrides: Partial<ExitRulePosition> = {}): ExitRulePosition => ({
  symbol: '7203',
  name: 'トヨタ自動車',
  assetClass: 'JP_EQUITY',
  accountType: 'SPECIFIC',
  entryDate: '2026-06-01',
  entryPrice: d(1000),
  totalShares: d(500),
  sharesRemaining: d(500),
  supportLevel: d(950),
  entryAtr: d(20),
  lotSize: 100,
  trailingMethod: null,
  ...overrides,
})

const bar = (tradingDay: string, close: number, overrides: Partial<FeedBar> = {}): FeedBar => ({
  tradingDay,
  close: d(close),
  sma10: d(close),
  sma20: d(close),
  rsi14: d(55),
  macd: d(1),
  macdSignal: d(0.5),
  macdHist: d(0.5),
  atr14: d(20),
  ...overrides,
})

describe('roundDownToLot', () => {
  it('rounds down to whole 100-share board lots', () => {
    // 500 × 0.5 = 250, which is not an order anyone can place on 東証.
    expect(roundDownToLot(d(250), 100).toString()).toBe('200')
    expect(roundDownToLot(d(700), 100).toString()).toBe('700')
  })

  it('rounds down, never up — over-trimming a winner is the costlier error', () => {
    expect(roundDownToLot(d(199), 100).toString()).toBe('100')
    expect(roundDownToLot(d(99), 100).toString()).toBe('0')
  })

  it('falls back to whole shares for US positions', () => {
    expect(roundDownToLot(d('250.5'), 1).toString()).toBe('250')
  })
})

describe('initialStopFor', () => {
  it('takes whichever of support and the ATR stop sits lower', () => {
    // support 950 vs 1000 − 1.5×20 = 970 → support wins, giving more room.
    expect(initialStopFor(position(), settings()).stop.toString()).toBe('950')
  })

  it('uses the ATR stop when support is the tighter of the two', () => {
    const result = initialStopFor(position({ supportLevel: d(990) }), settings())
    expect(result.stop.toString()).toBe('970')
    expect(result.fromSupportOnly).toBe(false)
  })

  it('falls back to support alone when no entry-date payload arrived', () => {
    // An alert created after the position was opened never delivers the entry
    // bar. Substituting a later ATR would be a retroactive recalculation.
    const result = initialStopFor(position({ entryAtr: null }), settings())
    expect(result.stop.toString()).toBe('950')
    expect(result.fromSupportOnly).toBe(true)
  })
})

describe('assess — targets and sizing', () => {
  it('derives R and Target 1 from the locked-in stop', () => {
    const result = assess(position(), [bar('2026-06-01', 1000)], settings(), '2026-06-01')
    expect(result.riskPerShare.toString()).toBe('50')
    expect(result.target1.toString()).toBe('1075')
  })

  it('respects a changed target multiplier', () => {
    const result = assess(
      position(),
      [bar('2026-06-01', 1000)],
      settings({ targetMultiple: d(2) }),
      '2026-06-01',
    )
    expect(result.target1.toString()).toBe('1100')
  })

  it('sizes the partial exit off the entry size, rounded to lots', () => {
    const result = assess(position(), [bar('2026-06-01', 1000)], settings(), '2026-06-01')
    expect(result.partialExitShares.toString()).toBe('200') // 500 × 0.5 → 250 → 200
  })

  it('ignores bars from before entry, so no pre-entry high seeds the trail', () => {
    const result = assess(
      position(),
      [bar('2026-05-20', 5000), bar('2026-06-01', 1000)],
      settings(),
      '2026-06-01',
    )
    expect(result.highestClose?.toString()).toBe('1000')
    expect(result.target1Hit).toBe(false)
  })
})

describe('assess — Target 1 and the trailing stop', () => {
  const hit = [bar('2026-06-01', 1000), bar('2026-06-02', 1080)]

  it('latches Target 1 on the first close that reaches it', () => {
    const result = assess(position(), hit, settings(), '2026-06-02')
    expect(result.target1Hit).toBe(true)
    expect(result.target1HitDate).toBe('2026-06-02')
  })

  it('keeps Target 1 latched after price falls back below it', () => {
    const result = assess(position(), [...hit, bar('2026-06-03', 1020)], settings(), '2026-06-03')
    expect(result.target1Hit).toBe(true)
    expect(result.target1HitDate).toBe('2026-06-02')
  })

  it('does not run the trail before Target 1', () => {
    const result = assess(position(), [bar('2026-06-01', 1050)], settings(), '2026-06-01')
    expect(result.trailingStop).toBeNull()
    expect(result.trailingActive).toBe(false)
    expect(result.currentStop.toString()).toBe('950') // still the initial stop
  })

  it('sets the chandelier at highest close − 3×ATR', () => {
    const result = assess(position(), hit, settings(), '2026-06-02')
    expect(result.trailingStop?.toString()).toBe('1020') // 1080 − 3×20
  })

  it('ratchets up only — a wider stop on a quieter day never loosens it', () => {
    const bars = [
      ...hit, // trail → 1080 − 60 = 1020
      bar('2026-06-03', 1100), // trail → 1100 − 60 = 1040
      bar('2026-06-04', 1050, { atr14: d(30) }), // would be 1100 − 90 = 1010
    ]
    const result = assess(position(), bars, settings(), '2026-06-04')
    expect(result.highestClose?.toString()).toBe('1100')
    expect(result.trailingStop?.toString()).toBe('1040')
  })

  it('follows a rising SMA but ignores it while it is falling', () => {
    const bars = [
      bar('2026-06-01', 1080, { sma10: d(1000) }), // Target 1 hit; no prior bar yet
      bar('2026-06-02', 1090, { sma10: d(1010) }), // rising → trail 1010
      bar('2026-06-03', 1085, { sma10: d(1005) }), // falling → not support, ignored
    ]
    const result = assess(position({ trailingMethod: 'SMA10' }), bars, settings(), '2026-06-03')
    expect(result.trailingMethod).toBe('SMA10')
    expect(result.trailingStop?.toString()).toBe('1010')
  })

  it('floors the stop at breakeven once Target 1 is in', () => {
    // Trail computes to 1080 − 60 = 1020, but the guarantee is that a trade
    // which reached its first target never becomes a loser.
    const low = [bar('2026-06-01', 1080, { atr14: d(60) })] // trail → 1080 − 180 = 900
    const result = assess(position(), low, settings(), '2026-06-01')
    expect(result.trailingStop?.toString()).toBe('900')
    expect(result.currentStop.toString()).toBe('1000') // breakeven wins
  })
})

describe('assess — time stop', () => {
  /** Five sessions of shrinking momentum, ending inside the stop and target. */
  const fading = [
    bar('2026-06-12', 1010, { macdHist: d(3) }),
    bar('2026-06-15', 1008, { macdHist: d(2) }),
    bar('2026-06-16', 1005, { macdHist: d(1) }),
    bar('2026-06-17', 1002, { macdHist: d('0.5') }),
    bar('2026-06-18', 1000, { macdHist: d('-0.2'), rsi14: d(45) }),
  ]

  it('fires when all four conditions hold at once', () => {
    // 13 trading days from 1 June to 18 June, Target 1 never reached.
    const result = assess(position(), fading, settings(), '2026-06-18')
    expect(result.tradingDaysHeld).toBe(13)
    expect(result.timeStopFlag).toBe(true)
    expect(result.action.kind).toBe('TIME_STOP')
  })

  it('does not fire while RSI is still at or above 50', () => {
    const strong = [
      ...fading.slice(0, 4),
      bar('2026-06-18', 1000, { macdHist: d('-0.2'), rsi14: d(52) }),
    ]
    expect(assess(position(), strong, settings(), '2026-06-18').timeStopFlag).toBe(false)
  })

  it('does not fire when the histogram is not strictly shrinking', () => {
    const bumpy = [
      bar('2026-06-12', 1010, { macdHist: d(3) }),
      bar('2026-06-15', 1008, { macdHist: d(2) }),
      bar('2026-06-16', 1005, { macdHist: d(4) }), // jumps back up
      bar('2026-06-17', 1002, { macdHist: d('0.5') }),
      bar('2026-06-18', 1000, { macdHist: d('-0.2'), rsi14: d(45) }),
    ]
    expect(assess(position(), bumpy, settings(), '2026-06-18').timeStopFlag).toBe(false)
  })

  it('needs a full five-bar window before it can judge momentum', () => {
    expect(assess(position(), fading.slice(-4), settings(), '2026-06-18').timeStopFlag).toBe(false)
  })

  it('never fires once Target 1 has been reached', () => {
    const reached = [bar('2026-06-02', 1080), ...fading]
    expect(assess(position(), reached, settings(), '2026-06-18').timeStopFlag).toBe(false)
  })

  it('counts trading days, not calendar days', () => {
    // 1 June → 17 June is 16 calendar days but only 12 sessions, so a
    // 12-day time stop must not have fired yet.
    const result = assess(position(), fading.slice(0, 4), settings(), '2026-06-17')
    expect(result.daysHeld).toBe(16)
    expect(result.tradingDaysHeld).toBe(12)
    expect(result.timeStopFlag).toBe(false)
  })

  it('respects a changed day count', () => {
    const result = assess(position(), fading, settings({ timeStopDays: 15 }), '2026-06-18')
    expect(result.timeStopFlag).toBe(false)
  })
})

describe('assess — stop-outs', () => {
  it('reports an ordinary stop-out when the close settles just through the stop', () => {
    const bars = [bar('2026-06-01', 980), bar('2026-06-02', 945)]
    const result = assess(position(), bars, settings(), '2026-06-02')
    expect(result.action.kind).toBe('STOPPED_OUT')
  })

  it('reports a gap when the close lands far below the stop in one session', () => {
    // 900 is more than half an ATR under the 950 stop, so a fill at the stop
    // is not a safe assumption.
    const bars = [bar('2026-06-01', 980), bar('2026-06-02', 900)]
    const result = assess(position(), bars, settings(), '2026-06-02')
    expect(result.action.kind).toBe('STOPPED_OUT_GAP')
    expect(result.action.message).toContain('fill at market')
  })

  it('does not call it a gap when price was already below the stop yesterday', () => {
    const bars = [bar('2026-06-01', 940), bar('2026-06-02', 900)]
    expect(assess(position(), bars, settings(), '2026-06-02').action.kind).toBe('STOPPED_OUT')
  })
})

describe('assess — staleness', () => {
  it('measures the gap in trading days, so a weekend is not a lapse', () => {
    // Friday bar, Monday view: one session missed, which is not stale.
    const result = assess(position(), [bar('2026-06-05', 1000)], settings(), '2026-06-08')
    expect(result.staleTradingDays).toBe(1)
    expect(result.stale).toBe(false)
  })

  it('flags a feed that has been quiet for more than three sessions', () => {
    const result = assess(position(), [bar('2026-06-01', 1000)], settings(), '2026-06-08')
    expect(result.staleTradingDays).toBe(5)
    expect(result.action.kind).toBe('DATA_STALE')
    expect(result.action.message).toContain('expired')
  })

  it('says so plainly when no payload has ever arrived', () => {
    expect(assess(position(), [], settings(), '2026-06-08').action.kind).toBe('AWAITING_FEED')
  })

  it('still reports a stop-out seen in stale data, and keeps the stale flag set', () => {
    // Knowing the last observed close was through the stop is more actionable
    // than knowing the feed is quiet — but the screen needs to show both.
    const bars = [bar('2026-06-01', 980), bar('2026-06-02', 900)]
    const result = assess(position(), bars, settings(), '2026-06-12')
    expect(result.action.kind).toBe('STOPPED_OUT_GAP')
    expect(result.stale).toBe(true)
  })
})

describe('assess — suggested action', () => {
  it('holds while price sits between the stop and Target 1', () => {
    const result = assess(position(), [bar('2026-06-01', 1020)], settings(), '2026-06-01')
    expect(result.action.kind).toBe('HOLD')
  })

  it('calls for the partial once Target 1 is reached and nothing has been sold', () => {
    const result = assess(position(), [bar('2026-06-01', 1080)], settings(), '2026-06-01')
    expect(result.action.kind).toBe('TAKE_PARTIAL')
    expect(result.action.message).toContain('sell 200 shares')
  })

  it('switches to the trail once the sell shows up in the trade history', () => {
    // sharesRemaining is the engine's pool quantity, so importing the Target 1
    // sell is what moves this on — no separate "mark as taken" state.
    const held = position({ sharesRemaining: d(300) })
    const bars = [bar('2026-06-01', 1080), bar('2026-06-02', 1100)]
    const result = assess(held, bars, settings(), '2026-06-02')
    expect(result.action.kind).toBe('TRAIL_ACTIVE')
    expect(result.action.message).toContain('¥1,040')
  })

  it('asks for a breakeven stop while the trail is still under entry', () => {
    const held = position({ sharesRemaining: d(300) })
    const result = assess(held, [bar('2026-06-01', 1080, { atr14: d(60) })], settings(), '2026-06-01')
    expect(result.action.kind).toBe('MOVE_TO_BREAKEVEN')
  })

  it('admits when a single lot cannot be halved', () => {
    const oneLot = position({ totalShares: d(100), sharesRemaining: d(100) })
    const result = assess(oneLot, [bar('2026-06-01', 1080)], settings(), '2026-06-01')
    expect(result.partialExitShares.toString()).toBe('0')
    expect(result.action.message).toContain('single lot')
  })

  it('retires a rule whose position has been fully closed', () => {
    const closed = position({ sharesRemaining: d(0) })
    expect(assess(closed, [bar('2026-06-01', 1080)], settings(), '2026-06-01').action.kind).toBe(
      'POSITION_CLOSED',
    )
  })

  it('formats US positions in dollars', () => {
    const us = position({ symbol: 'AAPL', assetClass: 'US_EQUITY', lotSize: 1 })
    const result = assess(us, [bar('2026-06-01', 1020)], settings(), '2026-06-01')
    expect(result.action.message).toContain('$1020.00')
  })
})
