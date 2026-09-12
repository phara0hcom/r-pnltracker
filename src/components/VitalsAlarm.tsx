/**
 * Reports a web vital only once it is bad enough to be news.
 *
 * Vercel Speed Insights already collects every vital and draws the trends — see
 * `VercelInsights` — but it cannot alert, and its `beforeSend` event carries
 * `{ type, url, route }` with no metric name and no value, so the numbers cannot
 * be borrowed from it either. Hence a second, tiny subscription.
 *
 * Two channels, because a vital is two different things. Every reading is sent as
 * a **metric** — a distribution, billed separately from errors and spans, which is
 * what gives percentiles and a trend. Only a reading in the poor band is also sent
 * as an **event**, which is the part that actually reaches someone.
 *
 * Recording the value as an error event alone — which is what this did first — kept
 * the fact that a threshold was crossed and discarded the number that crossed it.
 */
import { useEffect } from 'react'
import { onCLS, onINP, onLCP, type Metric } from 'web-vitals'
import { isPoorVital, type VitalName } from '~/lib/observability/vitals'

/** Sentry's unit names. CLS is a unitless ratio; the other two are durations. */
function unitFor(name: VitalName): string {
  return name === 'CLS' ? 'ratio' : 'millisecond'
}

export function VitalsAlarm() {
  useEffect(() => {
    /*
     * Imported lazily and reported through `report.ts` so that with no DSN this
     * is inert — and so the Sentry import is not on the hydration path for a
     * measurement that, in the normal case, is never sent.
     */
    const report = (metric: Metric) => {
      const name = metric.name as VitalName
      // CLS is a unitless ratio in the low hundredths; rounding it to an integer
      // would report every layout shift as 0.
      const value = name === 'CLS' ? Number(metric.value.toFixed(3)) : Math.round(metric.value)

      void import('~/lib/observability/report')
        .then(({ reportMeasurement, reportWarning }) => {
          /*
           * Every vital, as a measurement.
           *
           * This is the reading itself, so it is recorded whatever its value —
           * a distribution of LCP is the thing that shows a page getting slower,
           * which a count of times it was already bad cannot.
           */
          reportMeasurement(`web_vital.${name.toLowerCase()}`, value, unitFor(name), {
            vital: name,
            rating: metric.rating,
            // Whether this was a fresh load or a restore changes what a bad LCP means.
            navigationType: metric.navigationType,
          })

          /*
           * And an event, only in the poor band.
           *
           * The metric is a chart; this is the part that reaches someone. Kept
           * separate from the measurement above because it is an alert, and it
           * stays until metric alerting is confirmed on the project.
           */
          if (!isPoorVital(name, metric.value)) return
          reportWarning(
            `poor web vital: ${name}`,
            { vital: name, value, rating: metric.rating, navigationType: metric.navigationType },
            ['poor-web-vital', name],
          )
        })
        // A failed import must not become an unhandled rejection in the page,
        // which is the opposite of what reporting is for.
        .catch(() => undefined)
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
