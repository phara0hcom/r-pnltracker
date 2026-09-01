import styles from './YearBars.module.scss'
import { yen } from '~/components/format'

export interface YearBarRow {
  year: number
  count: number
  gross: string
  tax: string
  net: string
}

/**
 * By-year dividends as stacked net/withheld bars instead of a five-column
 * table — both scaled to the largest year's gross, so years compare directly.
 */
export function YearBars({ years }: { years: YearBarRow[] }) {
  const maxGross = Math.max(1, ...years.map((year) => Number(year.gross)))

  return (
    <div className={styles.card}>
      {years.map((year) => {
        const gross = Number(year.gross)
        const withheld = Number(year.tax)
        const net = Number(year.net)
        return (
          <div key={year.year}>
            <div className={styles.head}>
              <span className={styles.label}>
                {year.year}
                <span className={styles.count}> · {year.count} payments</span>
              </span>
              <span className={styles.net}>{yen(net)}</span>
            </div>
            <div className={styles.track}>
              <span className={styles.netFill} style={{ width: `${String((net / maxGross) * 100)}%` }} />
              <span className={styles.taxFill} style={{ width: `${String((withheld / maxGross) * 100)}%` }} />
            </div>
            <p className={styles.caption}>
              {yen(gross)} gross · {yen(withheld)} withheld
            </p>
          </div>
        )
      })}
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatchNet} />
          Net
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatchTax} />
          Withheld
        </span>
      </div>
    </div>
  )
}
