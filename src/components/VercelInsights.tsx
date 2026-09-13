/**
 * Vercel Speed Insights and Web Analytics.
 *
 * Neither package is Next-only — `@vercel/speed-insights/react` and
 * `@vercel/analytics/react` are the generic React entries, which is what a
 * TanStack Start app wants.
 *
 * Collection only happens on a Vercel deployment: both beacons are served from
 * `/_vercel/...`, a path Vercel's edge provides. Off Vercel — local dev,
 * `npm start`, anywhere else — they mount, find nothing there, and do nothing.
 * Inert rather than broken, so no environment guard is needed.
 *
 * This stays the source of web vitals. Speed Insights samples them at 100% and
 * draws the dashboards; Sentry's browser tracing would cost ~20 spans a
 * navigation against a 10,000-a-month budget to report the same numbers worse.
 * What it cannot do is alert, which is what `VitalsAlarm` is for.
 *
 * `stripQuery` now lives in `lib/observability/scrub.ts`, because Sentry needs
 * the identical rule and two copies of a privacy filter is one copy too many.
 */
import { useRouterState } from '@tanstack/react-router'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { stripQuery } from '~/lib/observability/scrub'

export function VercelInsights() {
  /*
   * Report the matched route pattern, not just the raw pathname.
   *
   * Every page route here is static today, so the two agree — but as soon as a
   * route takes a parameter (`/trades/$id`), reporting pathnames splits one
   * route's metrics into a separate bucket per id, which is how these numbers
   * quietly stop meaning anything. `fullPath` is the pattern, so it keeps
   * aggregating correctly without another edit.
   */
  const route = useRouterState({ select: (s) => s.matches.at(-1)?.fullPath ?? null })
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <>
      <SpeedInsights route={route} beforeSend={stripQuery} />
      <Analytics route={route} path={pathname} beforeSend={stripQuery} />
    </>
  )
}
