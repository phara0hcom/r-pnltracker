/**
 * The one place anything in this app reports a fault.
 *
 * Thirty-odd call sites report through these three functions rather than
 * importing the SDK, so three policies live in one file instead of being
 * repeated and drifting:
 *
 *   - **Unconfigured is silent.** With no DSN every function here is a no-op.
 *     That is the same shape as `TRADINGVIEW_WEBHOOK_SECRET` — unset disables the
 *     feature rather than failing it — and it is what keeps `npm test` and a
 *     fresh clone offline.
 *   - **Nothing here may throw.** Inherited verbatim from
 *     `src/lib/prices/providers.ts`: a reporting fault must never turn a working
 *     response into a 5xx, which matters most on the TradingView route, where a
 *     5xx is retried. Every call is wrapped.
 *   - **The channel is a decision, not an accident.** An event costs quota and
 *     may page someone; a breadcrumb is context on whatever fails next. Which
 *     one a given failure deserves is recorded at the call site by which
 *     function it calls.
 *
 * It lives in `src/lib/` alongside `prices/providers.ts`, which also does I/O.
 * CLAUDE.md's purity rule names the parsers, engine, NISA, tax and stats
 * modules; it is not a blanket ban, and keeping this here is what lets
 * `lib/exit/webhook.ts` report without reaching upward through the layers.
 */
import {
  addBreadcrumb,
  captureException,
  captureMessage,
  getClient,
  metrics,
  withScope,
} from '@sentry/tanstackstart-react'

/**
 * Non-identifying detail attached to a report.
 *
 * Ticker, account type, counts, durations, outcomes — the shape of the failure.
 * Never an amount: see the contract in `scrub.ts`. Amounts are excluded by
 * nothing ever putting one here, which is why this is `string | number | boolean`
 * and not `unknown`.
 */
export type ReportTags = Record<string, string | number | boolean | null | undefined>

/**
 * Whether a Sentry client exists to report to.
 *
 * Asked of the SDK rather than of the environment, because this module is the one
 * observability file that runs on *both* sides. `process.env.SENTRY_DSN` would be
 * a `ReferenceError` in the browser — `process` does not exist there and Vite
 * only substitutes `NODE_ENV` — and `import.meta.env.VITE_SENTRY_DSN` says
 * nothing about the server. `getClient()` is undefined until `init` runs and
 * correct on both sides; when a client does exist, its own `enabled` flag decides
 * whether anything is actually sent.
 */
function enabled(): boolean {
  return getClient() !== undefined
}

/**
 * A fault worth an alert: a real error object, with its stack.
 *
 * `tags` are indexed and searchable in Sentry, so they are where the ticker or
 * the failing operation belongs — not concatenated into the message, which would
 * split one issue into a separate group per value.
 */
export function reportError(error: unknown, tags: ReportTags = {}): void {
  if (!enabled()) return
  try {
    withScope((scope) => {
      scope.setTags(compact(tags))
      captureException(error instanceof Error ? error : new Error(String(error)))
    })
  } catch {
    // Reporting a failure must not become one.
  }
}

/**
 * A fault worth an alert that has no exception behind it.
 *
 * A slow server function, a price provider that gave up, a vital in the poor
 * band: all real signals, none of them a thrown error. `fingerprint` groups
 * them — without it Sentry groups by message, and a message carrying a symbol
 * list would open a new issue every time the list changed.
 */
export function reportWarning(
  message: string,
  tags: ReportTags = {},
  fingerprint?: string[],
): void {
  if (!enabled()) return
  try {
    withScope((scope) => {
      scope.setTags(compact(tags))
      if (fingerprint) scope.setFingerprint(fingerprint)
      captureMessage(message, 'warning')
    })
  } catch {
    // As above.
  }
}

/**
 * Context for whatever fails next, costing no quota.
 *
 * For failures that are expected and correctly handled — a private window
 * refusing `localStorage`, say. Worth knowing when a later error is being
 * explained; not worth an alert of its own.
 */
export function breadcrumb(message: string, data: ReportTags = {}): void {
  if (!enabled()) return
  try {
    addBreadcrumb({ message, level: 'info', data: compact(data) })
  } catch {
    // As above.
  }
}

/**
 * Records a measurement as a measurement.
 *
 * A duration or a web vital is a number, not a fault, and modelling one as an
 * error event was the wrong instrument: it spends the error budget, puts a
 * reading in the Issues stream, and keeps only the fact that a threshold was
 * crossed rather than the value that crossed it. A distribution keeps the shape —
 * percentiles rather than a count of complaints — and is billed separately from
 * both errors and spans.
 *
 * This does not replace the threshold alarms. A metric is a chart; an event is
 * the thing that reaches you. The alarms stay until metric alerting is confirmed
 * on the project, and they are rare by construction, so keeping both costs almost
 * nothing.
 *
 * `unit` takes Sentry's names — `millisecond`, `ratio`, `none`.
 */
export function reportMeasurement(
  name: string,
  value: number,
  unit: string,
  attributes: ReportTags = {},
): void {
  if (!enabled()) return
  try {
    metrics.distribution(name, value, { unit, attributes: compact(attributes) })
  } catch {
    // As above: measuring must not be able to fail the thing it measures.
  }
}

/** Sentry renders `null`/`undefined` tags as the strings "null"/"undefined". */
function compact(tags: ReportTags): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(tags).filter(
      (entry): entry is [string, string | number | boolean] => entry[1] != null,
    ),
  )
}
