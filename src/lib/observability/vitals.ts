/**
 * Which web vitals are worth waking someone for.
 *
 * Vercel Speed Insights already collects every vital at 100% sampling and draws
 * the dashboards — see `src/components/VercelInsights.tsx`. It cannot be asked
 * to *alert*, though, and its `beforeSend` event is `{ type, url, route }` with
 * no metric name and no value, so the numbers cannot be borrowed from it either.
 *
 * So this is the alarm, not the dashboard: a vital is reported only once it is
 * bad enough to be a regression rather than a data point. Reporting all of them
 * would spend the error quota on numbers that are already recorded elsewhere.
 *
 * Thresholds are Google's "poor" boundaries — the upper bound of "needs
 * improvement" — not the "good" ones, deliberately. A page crossing into `good`
 * is not news; a page crossing into `poor` is.
 */

/** Google's "poor" boundary per metric. Below these, the vital is not reported. */
export const POOR_VITALS = {
  LCP: 4000,
  INP: 500,
  CLS: 0.25,
} as const

export type VitalName = keyof typeof POOR_VITALS

export function isPoorVital(name: VitalName, value: number): boolean {
  return value > POOR_VITALS[name]
}
