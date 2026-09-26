import type { WindowNav } from './MonthlyPnlChart'
import styles from './MonthlyZeroBars.module.scss'
import { ZeroBar } from './ZeroBar'
import { pctSigned, yenCompact } from '~/components/format'
import { cx } from '~/lib/cx'
import type { MonthlyPoint } from '~/server/portfolio'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-09` → `Sep 2026` — `09/26` read as a day of the month. */
const label = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}`

/**
 * Monthly realized P&L as zero-origin rows — the SP replacement for
 * `MonthlyPnlChart`. A 390px column chart leaves each bar a few pixels wide;
 * a row has the full card width to grow into instead.
 */
export function MonthlyZeroBars({ data, nav }: { data: MonthlyPoint[]; nav?: WindowNav }) {
  if (data.length === 0) {
    return <p className={styles.empty}>No closed trades yet.</p>
  }

  const values = data.map((point) => Number(point.realizedJpy))
  const maxPos = Math.max(0, ...values)
  const maxNeg = Math.abs(Math.min(0, ...values))

  return (
    <div className={styles.card}>
      {nav ? (
        <div className={styles.nav}>
          <span className={styles.navLabel}>{nav.label}</span>
          <div className={styles.navButtons}>
            <button
              type="button"
              className={styles.navButton}
              onClick={nav.onBack}
              disabled={!nav.canGoBack}
              aria-label="Show earlier months"
            >
              ←
            </button>
            <button
              type="button"
              className={styles.navButton}
              onClick={nav.onForward}
              disabled={!nav.canGoForward}
              aria-label="Show later months"
            >
              →
            </button>
            <button
              type="button"
              className={styles.navButton}
              onClick={nav.onLatest}
              disabled={!nav.canGoForward}
            >
              Latest
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.header} aria-hidden="true">
        <span className={styles.month}>Month</span>
        <span className={styles.headerMid}>loss · ¥0 · profit</span>
        <span className={styles.net}>Net</span>
        <span className={styles.pct}>%</span>
      </div>

      {data.map((point) => {
        const value = Number(point.realizedJpy)
        const zero = point.tradeCount === 0
        return (
          <div key={point.month} className={styles.row}>
            <span className={styles.month}>{label(point.month)}</span>
            <div className={styles.track}>
              <ZeroBar value={value} maxPos={maxPos} maxNeg={maxNeg} />
            </div>
            <span
              className={cx(
                styles.net,
                zero ? styles.muted : value >= 0 ? styles.profit : styles.loss,
              )}
            >
              {zero ? '·' : yenCompact(value)}
            </span>
            <span className={styles.pct}>{zero || point.returnPct == null ? '' : pctSigned(point.returnPct)}</span>
          </div>
        )
      })}
    </div>
  )
}
