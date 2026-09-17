/**
 * Which exit-feed deliveries are worth an event, and how they group.
 *
 * Lives beside `vitals.ts` and `scrub.ts` because it is the same kind of thing
 * they are: a pure, unit-tested rule about what deserves the error budget and
 * what is merely a reading. It began in `lib/exit/webhook.ts`, whose header
 * says that file is for parsing the Pine payload — which this is not, and a
 * reader looking for a Sentry channel rule would never grep it.
 */
/**
 * The `route` tag and fingerprint head every report from this endpoint shares.
 *
 * One constant rather than a literal typed out at each call site. Renaming or
 * mistyping it in one place would fork the endpoint's issues in Sentry: half
 * the events would stop matching a `route:` search and the fingerprint groups
 * would split, so existing issues quietly stop accumulating and new ones open.
 * Nothing would fail, and the symptom is an issue list that looks calm.
 */
export const TV_WEBHOOK_ROUTE = 'tv-webhook'

/**
 * How a delivery ended.
 *
 * Stated here rather than derived from the database's `feed_delivery_outcome`
 * enum. That derivation was worth it while the delivery log was written and
 * read; now that nothing writes it, it would keep a dormant table, its enum and
 * a migration alive to type three strings — and would make this module, in
 * `src/lib/`, reach into `src/db/` against the rule in CLAUDE.md.
 *
 * Drift is still caught where it matters: the route types its own `outcome` as
 * the database's `FeedDeliveryOutcome` and passes it in here, so the two unions
 * have to stay assignable or the call stops compiling.
 */
export type FeedOutcome = 'STORED' | 'UNKNOWN_TICKER' | 'INVALID_PAYLOAD'

/**
 * A delivery slower than this is announced, not merely measured.
 *
 * The same 2s line `SLOW_SERVER_FN_MS` draws for server functions, and stated
 * again because that one cannot reach this route: the alarm in `src/start.ts`
 * lives in a `type: 'function'` middleware, which wraps server functions only.
 * A route handler never runs it, whatever the header of that file hoped.
 *
 * It matters more here than there. Every alert of the day fires at the same
 * close, and TradingView gives up on an alert that answers too late — so a
 * delivery that has slowed is the difference between a bar arriving and a bar
 * being lost, with nothing on screen to say which happened.
 */
export const SLOW_FEED_DELIVERY_MS = 2000

/**
 * The channel a delivery deserves.
 *
 * `fingerprint` is the part that is easy to get wrong. Sentry groups by message
 * by default, so a message carrying a ticker opens a fresh issue per ticker —
 * one alert misconfigured across eight positions would arrive as eight issues.
 * The messages here are therefore constant and the detail travels as tags.
 */
export type FeedDeliveryReport =
  | { channel: 'warning'; message: string; fingerprint: string[] }
  | { channel: 'breadcrumb'; message: string }

export function feedDeliveryReport(
  outcome: FeedOutcome,
  durationMs: number,
): FeedDeliveryReport {
  switch (outcome) {
    /*
     * Pine sent something unparseable. Invisible everywhere else: TradingView
     * shows the alert as delivered — it got a response — and the bar simply
     * never appears.
     */
    case 'INVALID_PAYLOAD':
      return {
        channel: 'warning',
        message: 'exit feed: payload rejected',
        fingerprint: [TV_WEBHOOK_ROUTE, 'INVALID_PAYLOAD'],
      }

    /*
     * An alert exists for an instrument this account has never traded. Not
     * retryable and not a fault of the route, but it is always a real mistake
     * in the alert list, and it is silent: the bar is discarded and the Exit
     * Rules card just stays stale.
     */
    case 'UNKNOWN_TICKER':
      return {
        channel: 'warning',
        message: 'exit feed: no instrument for ticker',
        fingerprint: [TV_WEBHOOK_ROUTE, 'UNKNOWN_TICKER'],
      }

    case 'STORED':
      return durationMs > SLOW_FEED_DELIVERY_MS
        ? {
            channel: 'warning',
            message: 'exit feed: slow delivery',
            fingerprint: [TV_WEBHOOK_ROUTE, 'slow-delivery'],
          }
        : /*
           * The ordinary case, and the one that must stay cheap. A bar landed
           * in time; that is context for whatever fails next, not an alert. The
           * count and the latency behind it are carried by the measurement the
           * route records for every delivery.
           */
          { channel: 'breadcrumb', message: 'exit feed: bar stored' }
  }
}
