/**
 * One period's numbers.
 *
 * Wins and losses are shown separately rather than only the net: a flat month
 * from no trading and a flat month from ¥500k of gains cancelling ¥500k of
 * losses are very different months, and the net alone hides that.
 */
import styles from './PeriodCard.module.scss'
import { pct, yen, yenSigned } from '~/components/format'
import { cx } from '~/lib/cx'
import type { PeriodSummary } from '~/server/portfolio'

export function PeriodCard({ period }: { period: PeriodSummary }) {
  const net = Number(period.realizedJpy)
  const quiet = period.tradeCount === 0

  return (
    <div className={styles.period}>
      <div className={styles.head}>
        <h3 className={styles.title}>{period.label}</h3>
        <span className={styles.count}>
          {period.tradeCount} close{period.tradeCount === 1 ? '' : 's'}
        </span>
      </div>

      {quiet ? (
        <p className={styles.empty}>No closed trades in this period.</p>
      ) : (
        <>
          <div className={styles.netRow}>
            <span
              className={cx(styles.net, net > 0 ? styles.profit : net < 0 ? styles.loss : undefined)}
            >
              {yenSigned(net)}
            </span>
            {period.returnPct != null ? (
              <span
                className={cx(
                  styles.pct,
                  period.returnPct > 0
                    ? styles.profit
                    : period.returnPct < 0
                      ? styles.loss
                      : undefined,
                )}
                title={`on ${yen(period.costJpy)} of closed cost basis`}
              >
                {period.returnPct >= 0 ? '+' : ''}
                {(period.returnPct * 100).toFixed(1)}%
              </span>
            ) : null}
          </div>
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt>Gains</dt>
              <dd className={styles.profit}>{yen(period.grossProfitJpy)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Losses</dt>
              <dd className={styles.loss}>{yen(period.grossLossJpy)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Closed cost</dt>
              <dd className={styles.dim}>{yen(period.costJpy)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Win rate</dt>
              <dd>
                {pct(period.winRate, 0)}
                <span className={styles.dim}>
                  {' '}
                  ({period.winCount}W / {period.lossCount}L)
                </span>
              </dd>
            </div>
          </dl>
        </>
      )}
    </div>
  )
}
