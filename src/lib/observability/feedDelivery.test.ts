/**
 * The rule deciding which deliveries reach Sentry as events.
 *
 * Pure, so the policy is readable and pinned on its own rather than inferred
 * from four scattered call sites in the route.
 */
import { describe, expect, it } from 'vitest'
import { feedDeliveryReport, SLOW_FEED_DELIVERY_MS } from './feedDelivery'

describe('feedDeliveryReport', () => {
  it('announces a rejected payload, which is otherwise invisible', () => {
    // TradingView reports this alert as delivered — it did get a response — and
    // the bar simply never appears. Nothing else says why.
    const report = feedDeliveryReport('INVALID_PAYLOAD', 40)
    expect(report.channel).toBe('warning')
  })

  it('announces a ticker with no instrument behind it', () => {
    const report = feedDeliveryReport('UNKNOWN_TICKER', 40)
    expect(report.channel).toBe('warning')
  })

  it('leaves an ordinary stored bar as a breadcrumb, not an alert', () => {
    // The common case by a wide margin: one per open position per session. An
    // event each would spend the error budget on the feed working.
    expect(feedDeliveryReport('STORED', 40)).toEqual({
      channel: 'breadcrumb',
      message: 'exit feed: bar stored',
    })
  })

  it('announces a stored bar that took too long', () => {
    // Stored is not the same as delivered: TradingView abandons an alert that
    // answers too late, so a slow success is a bar at risk of being lost.
    const report = feedDeliveryReport('STORED', SLOW_FEED_DELIVERY_MS + 1)
    expect(report.channel).toBe('warning')
  })

  it('treats the threshold itself as fast, matching the server-function alarm', () => {
    expect(feedDeliveryReport('STORED', SLOW_FEED_DELIVERY_MS).channel).toBe('breadcrumb')
  })

  it('groups by outcome rather than by message', () => {
    /*
     * The trap this exists to avoid: Sentry groups by message unless told
     * otherwise, so a message carrying the ticker would open one issue per
     * ticker — eight positions on a misconfigured alert arriving as eight
     * issues. Constant messages, and a fingerprint that is stable across
     * deliveries.
     */
    const first = feedDeliveryReport('UNKNOWN_TICKER', 10)
    const second = feedDeliveryReport('UNKNOWN_TICKER', 900)
    expect(first).toEqual(second)

    const outcomes = ['INVALID_PAYLOAD', 'UNKNOWN_TICKER'] as const
    const fingerprints = outcomes.map((outcome) => {
      const report = feedDeliveryReport(outcome, 10)
      return report.channel === 'warning' ? report.fingerprint.join('/') : ''
    })
    expect(new Set(fingerprints).size).toBe(outcomes.length)
  })

  it('never puts a ticker or an amount in the message', () => {
    // Amounts are excluded by construction, not by a filter — see `scrub.ts`.
    // This function is handed no figures at all, which is the construction.
    const messages = (['STORED', 'UNKNOWN_TICKER', 'INVALID_PAYLOAD'] as const).map(
      (outcome) => feedDeliveryReport(outcome, 10).message,
    )
    for (const message of messages) expect(message).not.toMatch(/\d/)
  })
})
