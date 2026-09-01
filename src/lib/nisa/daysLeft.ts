/**
 * Days remaining before an annual NISA frame expires.
 *
 * Pure date arithmetic, kept in UTC throughout — mixing local-time `Date`
 * construction with subtraction risks an off-by-one around a DST transition.
 * There is no such transition in Japan, but the server process may not be
 * running in JST, so this stays timezone-agnostic by construction rather than
 * by accident.
 */
export function daysUntilYearEnd(todayIso: string): number {
  const [year, month, day] = todayIso.split('-').map(Number)
  const todayUtc = Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1)
  const yearEndUtc = Date.UTC(year ?? 2026, 11, 31)
  return Math.round((yearEndUtc - todayUtc) / 86_400_000)
}
