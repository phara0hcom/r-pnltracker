/**
 * The verdict, which is the only judgement this component makes.
 *
 * Everything else on the row is a value passed straight through. The verdict is
 * the part that turns four stored fields into the sentence the reader came for,
 * and the distinction it has to keep is the one the whole log exists for: a
 * delivery that was *stored* and merely answered slowly is not a failure of the
 * feed, and must not be coloured like one — but it must not read as clean
 * either, because a TradingView alert may well have given up waiting for it.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FeedDeliveryLog } from './FeedDeliveryLog'
import type { FeedDeliveryView } from '~/server/exit'

const TALLY = { total: 3, stored: 2, failed: 1, slowestMs: 4200 }

const delivery = (over: Partial<FeedDeliveryView> = {}): FeedDeliveryView => ({
  id: 'd1',
  receivedAt: '2026-09-04T06:00:00.000Z',
  durationMs: 120,
  outcome: 'STORED',
  status: 200,
  ticker: '7203',
  name: 'トヨタ自動車',
  tradingDay: '2026-09-04',
  backfilled: 0,
  priced: true,
  detail: null,
  ...over,
})

const show = (rows: FeedDeliveryView[]) =>
  render(<FeedDeliveryLog deliveries={rows} tally={TALLY} />)

describe('FeedDeliveryLog', () => {
  it('calls a fast stored delivery simply stored', () => {
    show([delivery()])
    expect(screen.getByText('Stored')).toBeTruthy()
  })

  it('marks a stored delivery slow without calling it a failure', () => {
    // The case the log was built for: the bar landed, and the alert may still
    // have timed out waiting for the answer.
    show([delivery({ durationMs: 6500 })])

    expect(screen.getByText('Stored, slow')).toBeTruthy()
    expect(screen.getByText('6.50 s')).toBeTruthy()
  })

  it('surfaces a pricing fault that used to reach the console alone', () => {
    show([delivery({ priced: false, detail: 'invalid input value for enum price_source' })])

    expect(screen.getByText('Stored, price failed')).toBeTruthy()
    expect(screen.getByText(/invalid input value/)).toBeTruthy()
  })

  it('separates a refused payload from a ticker nothing matches', () => {
    show([
      delivery({ id: 'a', outcome: 'UNKNOWN_TICKER', status: 404, name: null, tradingDay: null }),
      delivery({ id: 'b', outcome: 'INVALID_PAYLOAD', status: 400, ticker: null, name: null }),
    ])

    expect(screen.getByText('Unknown ticker')).toBeTruthy()
    expect(screen.getByText('Payload refused')).toBeTruthy()
  })

  it('says what an unknown ticker actually means, rather than leaving it blank', () => {
    // The alert fired correctly and the endpoint answered correctly; what is
    // wrong is upstream of both, so the row has to say so.
    show([delivery({ outcome: 'UNKNOWN_TICKER', status: 404, ticker: 'ZZZZ', name: null })])
    expect(screen.getByText('no instrument carries this ticker')).toBeTruthy()
  })

  it('says why an empty log is not the same as a silent feed', () => {
    // An unauthenticated probe is answered 404 and never recorded, so an empty
    // table has to explain itself rather than read as "nothing ever arrived".
    show([])
    expect(screen.getByText(/No deliveries recorded yet/)).toBeTruthy()
  })

  it('reports how many entry ATRs a delivery completed', () => {
    show([delivery({ backfilled: 2 })])
    expect(screen.getByText(/2 entry ATR filled/)).toBeTruthy()
  })
})
