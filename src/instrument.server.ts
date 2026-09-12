/**
 * Server-side Sentry initialisation.
 *
 * Imported for its side effect as the first statement of `src/server.ts`, which
 * is the SSR rollup input — so it is reachable only from the server build and
 * never appears in the client graph.
 *
 * Deliberately `src/instrument.server.ts` and not `instrument.server.mjs` at the
 * repo root, which is what Sentry's docs suggest. That path sits outside
 * `tsconfig.json`'s `include` and outside the type-aware ESLint config, so it
 * would be neither typechecked nor lintable — and `npm run lint` must stay clean
 * at zero warnings. The root file exists in the docs to support
 * `node --import`, which Vercel gives us no way to set.
 *
 * A consequence of that, and the reason the spans in `server/engine.ts` are not
 * optional: Nitro reaches this file through two lazy dynamic imports, so `init`
 * runs on the first *request*, after the server chunk's own static imports have
 * been evaluated. OpenTelemetry's module patching cannot work from there, and
 * `pg` is inlined into the bundle anyway — so there are no automatic database
 * spans. What time the database costs, we measure by hand.
 */
import * as Sentry from '@sentry/tanstackstart-react'
import { scrubBreadcrumb, scrubEvent, scrubTransaction } from '~/lib/observability/scrub'

const dsn = process.env.SENTRY_DSN

Sentry.init({
  dsn,
  /*
   * Unset DSN disables reporting rather than failing.
   *
   * Local dev, a fresh clone and CI all run without one, and none of them should
   * acquire a network dependency by accident. Same stance as
   * `TRADINGVIEW_WEBHOOK_SECRET`.
   */
  enabled: dsn !== undefined,
  environment: process.env.VERCEL_ENV ?? 'development',

  /*
   * 1-in-20.
   *
   * The free tier allows 10,000 spans a month, and `defaultPreload: 'intent'`
   * means hovering a nav link already costs one — so full tracing would exhaust
   * the budget in days. A 5% sample is enough to see the *shape* of latency for a
   * single user; the guarantee that a slow request is never missed comes from the
   * threshold alarm in `src/start.ts`, which is billed as an error instead.
   */
  tracesSampleRate: 0.05,

  /*
   * The three hooks, all wired.
   *
   * `beforeSend` is never called for a transaction and neither is called for a
   * breadcrumb, so scrubbing only one of them leaves the other two carrying the
   * TradingView secret and the session cookie. See `lib/observability/scrub.ts`.
   */
  beforeSend: (event) => scrubEvent(event),
  beforeSendTransaction: (event) => scrubTransaction(event),
  beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),

  /*
   * No console integration on the server.
   *
   * It turns every `console.error` into a breadcrumb attached to whatever event
   * comes next, and this app's server logs are prefixed diagnostics written for a
   * terminal — including, until this change, the signed-in address. Those nine
   * lines stay useful where they are; they are not telemetry.
   */
  integrations: (defaults) => defaults.filter((i) => i.name !== 'Console'),

  /*
   * Rejections are the system working.
   *
   * `authed` throws `Unauthorised` and `sameOrigin` throws on a cross-origin POST.
   * Both are wrapped by the global function middleware across all 28 server
   * functions, so a single crawler probing `_authed` would otherwise arrive as a
   * burst of identical issues and spend the month's error budget on a working
   * allowlist.
   */
  ignoreErrors: ['Unauthorised', 'Cross-origin request rejected'],

  sendDefaultPii: false,
})
