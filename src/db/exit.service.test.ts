/**
 * Whether a stored bar is the newest one held.
 *
 * The answer decides if the close is fit to publish as the instrument's current
 * price, and it is the guard against the one thing that reliably happens here:
 * TradingView resends bars after a chart reload. Recording a replayed bar is
 * right — it corrects the row for its own day — but its close is old, and
 * publishing it would move the current price backwards with no trace.
 *
 * No database. A proxy driver answers the read-back with canned rows, which is
 * the only input the decision has.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const recorder = vi.hoisted(() => ({
  /** Rows the read-back returns — the newest trading day held, or nothing. */
  newest: [] as unknown[][],
  statements: [] as string[],
}))

vi.mock('~/db/index', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  return {
    db: drizzle((sql: string) => {
      recorder.statements.push(sql)
      // The insert returns nothing; only the max() read-back is answered.
      return Promise.resolve({ rows: sql.trimStart().startsWith('select') ? recorder.newest : [] })
    }),
  }
})

const { recordFeedBar } = await import('./exit.service')

const bar = (tradingDay: string) => ({
  instrumentId: 'i1',
  tradingDay,
  barTime: new Date(`${tradingDay}T06:00:00Z`),
  exchange: 'TSE',
  close: '2684',
  sma10: '2700',
  sma20: '2750',
  rsi14: '31.4',
  macd: '-12',
  macdSignal: '-10',
  macdHist: '-2',
  atr14: '88',
})

beforeEach(() => {
  recorder.statements.length = 0
  recorder.newest.length = 0
})

describe('recordFeedBar', () => {
  it('stores the bar before deciding, so the answer includes it', async () => {
    recorder.newest.push(['2026-09-04'])
    await recordFeedBar(bar('2026-09-04'))

    // Read back rather than compared against a prior read: the insert is
    // already committed, so a concurrent delivery for a later day cannot make
    // the answer wrong after the fact.
    expect(recorder.statements[0]?.trimStart().startsWith('insert')).toBe(true)
    expect(recorder.statements[1]?.trimStart().startsWith('select')).toBe(true)
  })

  it('calls today’s bar the latest', async () => {
    recorder.newest.push(['2026-09-04'])
    expect(await recordFeedBar(bar('2026-09-04'))).toEqual({ isLatest: true })
  })

  it('refuses a replayed bar that a newer day has already superseded', async () => {
    // The resend case. Its own row is still corrected by the upsert above; only
    // the right to publish its close as *current* is withheld.
    recorder.newest.push(['2026-09-04'])
    expect(await recordFeedBar(bar('2026-08-28'))).toEqual({ isLatest: false })
  })

  it('claims nothing when the read-back comes back empty', async () => {
    // Should not happen — the insert precedes it — so the safe answer is the
    // one that declines to touch the price.
    expect(await recordFeedBar(bar('2026-09-04'))).toEqual({ isLatest: false })
  })
})
