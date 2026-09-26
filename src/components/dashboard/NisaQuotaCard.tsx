/**
 * NISA quota on the dashboard: the ¥18M lifetime pool and this year's two
 * annual frames, each against its own limit.
 *
 * The annual frames are the ones a buying decision runs into — the lifetime
 * pool is years from full — so a frame close to its cap says so in words, not
 * only by the length of its bar. Display only: every figure arrives computed.
 */
import styles from './NisaQuotaCard.module.scss'
import { yen } from '~/components/format'
import { cx } from '~/lib/cx'
import type { DashboardNisa } from '~/server/portfolio'

/** Close enough to the cap that the rest of the year's buying has to be planned around it. */
const NEARLY_FULL = 0.9

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2027-01` → `Jan 2027`. */
const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''} ${iso.slice(0, 4)}`

interface Row {
  key: string
  label: string
  sub: string
  used: string
  limit: string
  remaining: string
  utilization: number
  fill: string
  /** An annual frame: when full, it stays full until January. */
  annual: boolean
}

export function NisaQuotaCard({ nisa }: { nisa: DashboardNisa }) {
  const rows: Row[] = [
    {
      key: 'lifetime',
      label: 'Lifetime',
      sub: '非課税保有限度額 · 旧NISA not counted',
      used: nisa.lifetimeUsedJpy,
      limit: nisa.lifetimeLimitJpy,
      remaining: nisa.lifetimeRemainingJpy,
      utilization: nisa.lifetimeUtilization,
      fill: styles.fillLifetime ?? '',
      annual: false,
    },
    {
      key: 'growth',
      label: `成長投資枠 ${String(nisa.year)}`,
      sub: 'Resets 1 January',
      used: nisa.growthUsedJpy,
      limit: nisa.growthLimitJpy,
      remaining: nisa.growthRemainingJpy,
      utilization: nisa.growthUtilization,
      fill: styles.fillGrowth ?? '',
      annual: true,
    },
    {
      key: 'tsumitate',
      label: `つみたて投資枠 ${String(nisa.year)}`,
      sub: 'Resets 1 January',
      used: nisa.tsumitateUsedJpy,
      limit: nisa.tsumitateLimitJpy,
      remaining: nisa.tsumitateRemainingJpy,
      utilization: nisa.tsumitateUtilization,
      fill: styles.fillTsumitate ?? '',
      annual: true,
    },
  ]

  return (
    <section className={styles.card} aria-labelledby="nisa-quota-title">
      <div className={styles.head}>
        <h2 id="nisa-quota-title" className={styles.title}>
          NISA quota
        </h2>
        {Number(nisa.pendingRestorationJpy) > 0 ? (
          <p className={styles.restoring}>
            {yen(nisa.pendingRestorationJpy)} of lifetime quota comes back in{' '}
            {monthYear(nisa.restorationDate)}, from this year&apos;s NISA sales
          </p>
        ) : null}
      </div>

      <div className={styles.rows}>
        {rows.map((row) => {
          const full = row.utilization >= 1
          const tight = row.annual && row.utilization >= NEARLY_FULL
          return (
            <div key={row.key} className={styles.row}>
              <div className={styles.name}>
                <span className={styles.label}>{row.label}</span>
                <span className={styles.sub}>{row.sub}</span>
              </div>
              <div
                className={styles.track}
                role="meter"
                aria-label={`${row.label} used`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(Math.min(row.utilization, 1) * 100)}
              >
                <div
                  className={cx(styles.fill, row.fill)}
                  style={{ width: `${String(Math.min(row.utilization, 1) * 100)}%` }}
                />
              </div>
              <div className={styles.figures}>
                <span>
                  <span className={styles.used}>{yen(row.used)}</span>
                  <span className={styles.of}> of {yen(row.limit)}</span>
                </span>
                <span className={cx(styles.left, tight && styles.warn)}>
                  {full
                    ? 'Full until January'
                    : tight
                      ? `Only ${yen(row.remaining)} left this year`
                      : `${yen(row.remaining)} left${row.annual ? ' this year' : ''}`}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
