/**
 * Browser-side Sentry initialisation — errors only.
 *
 * Imported for its side effect as the first statement of `src/client.tsx`.
 *
 * No tracing, no session replay, and so no `browserTracingIntegration`:
 *
 *   - **Tracing** would emit a pageload transaction plus ~20 resource child spans
 *     per navigation, which at a few hundred navigations a day is the entire
 *     10,000-span monthly budget — spent on numbers Vercel Speed Insights already
 *     collects at 100% sampling rather than 5%. `VitalsAlarm` covers the part
 *     Speed Insights cannot do, which is telling us when a vital got bad.
 *   - **Replay** would record the portfolio screens.
 *
 * What is left is the thing that genuinely had no coverage: a render crash on a
 * phone, which until now showed `ErrorPage` and was forgotten.
 */
import * as Sentry from '@sentry/tanstackstart-react'
import { scrubBreadcrumb, scrubEvent, scrubMetric } from '~/lib/observability/scrub'

/*
 * `VITE_` prefix is what lets this reach the browser at all, and it is inlined at
 * build time — so setting it on Vercel after a deploy needs a redeploy to take
 * effect. A DSN is not a secret; it is public by design and already in the bundle.
 */
const configured = import.meta.env.VITE_SENTRY_DSN?.trim()
// An empty string is still a string — see `instrument.server.ts`.
const dsn = configured === '' ? undefined : configured

Sentry.init({
  dsn,
  enabled: dsn !== undefined,
  environment: import.meta.env.MODE,

  tracesSampleRate: 0,

  beforeSend: (event) => scrubEvent(event),
  beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),

  // Web vitals are recorded as metrics — see `VitalsAlarm`. Off by default.
  enableMetrics: true,
  beforeSendMetric: (metric) => scrubMetric(metric),

  sendDefaultPii: false,
})
