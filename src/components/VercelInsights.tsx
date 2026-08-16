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
 */
import { useRouterState } from '@tanstack/react-router'
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'

/**
 * Drops the query string before a page view leaves the browser.
 *
 * This app puts filter state in the URL: `?symbol=8411&from=2026-01-01&account=…`.
 * That is a description of what the user holds and when they traded it, and it
 * has no analytics value — the path alone answers "which screens get used".
 * The root document already sets `noindex` and `referrer: no-referrer`, so
 * shipping the same information to an analytics endpoint would undo that.
 */
function stripQuery(event: BeforeSendEvent): BeforeSendEvent {
  const cut = event.url.indexOf('?')
  return cut === -1 ? event : { ...event, url: event.url.slice(0, cut) }
}

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
      <SpeedInsights route={route} />
      <Analytics route={route} path={pathname} beforeSend={stripQuery} />
    </>
  )
}
