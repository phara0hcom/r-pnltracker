/**
 * Reports a web vital only once it is bad enough to be news.
 *
 * Vercel Speed Insights already collects every vital and draws the trends — see
 * `VercelInsights` — but it cannot alert, and its `beforeSend` event carries
 * `{ type, url, route }` with no metric name and no value, so the numbers cannot
 * be borrowed from it either. Hence a second, tiny subscription.
 *
 * Only the poor band is sent. Reporting every vital would spend the error budget
 * restating what Speed Insights already stores, and a channel that reports normal
 * measurements stops being read. The effect is that a page getting slower reaches
 * the same inbox as a slow server function, by the same mechanism — an event
 * rather than a span, so it costs nothing against the span quota.
 */
import { useEffect } from 'react'
import { onCLS, onINP, onLCP, type Metric } from 'web-vitals'
import { isPoorVital, type VitalName } from '~/lib/observability/vitals'

export function VitalsAlarm() {
  useEffect(() => {
    /*
     * Imported lazily and reported through `report.ts` so that with no DSN this
     * is inert — and so the Sentry import is not on the hydration path for a
     * measurement that, in the normal case, is never sent.
     */
    const report = (metric: Metric) => {
      const name = metric.name as VitalName
      if (!isPoorVital(name, metric.value)) return

      void import('~/lib/observability/report').then(({ reportWarning }) => {
        reportWarning(
          `poor web vital: ${name}`,
          {
            vital: name,
            // CLS is unitless and small; rounding it to an integer would report 0.
            value: name === 'CLS' ? Number(metric.value.toFixed(3)) : Math.round(metric.value),
            rating: metric.rating,
            // The path only. `navigationType` says whether this was a fresh load
            // or a restore, which changes what a bad LCP means.
            navigationType: metric.navigationType,
          },
          ['poor-web-vital', name],
        )
      })
    }

    /*
     * The three vitals Google scores, and the three that have a "poor" boundary.
     * Each fires at most once per page for LCP, and on change for CLS and INP —
     * the library handles the debouncing, so `isPoorVital` is the only gate here.
     */
    onLCP(report)
    onINP(report)
    onCLS(report)
  }, [])

  return null
}
