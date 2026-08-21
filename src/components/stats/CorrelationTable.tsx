/**
 * Realized P&L bucketed by a 1–5 journal score.
 *
 * Both the average and the total are shown: a single outlier day can dominate a
 * total, and the average alone hides how few days a bucket rests on — the day
 * count sits alongside for that reason.
 */
import styles from './CorrelationTable.module.scss'
import { tone, yenSigned } from '~/components/format'
import { Table } from '~/components/screen'

export interface CorrelationRow {
  score: number
  days: number
  totalPnl: string
  avgPnl: string
}

export function CorrelationTable({
  caption,
  rows,
}: {
  caption: string
  rows: CorrelationRow[]
}) {
  return (
    <div>
      <h3 className={styles.title}>{caption}</h3>
      <Table>
        <thead>
          <tr>
            <th scope="col">Score</th>
            <th scope="col" data-numeric>Days</th>
            <th scope="col" data-numeric>Avg P&L</th>
            <th scope="col" data-numeric>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.score}>
              <td>
                {'★'.repeat(row.score)}
                <span className={styles.dim}>{'☆'.repeat(5 - row.score)}</span>
              </td>
              <td data-numeric>{row.days}</td>
              <td data-numeric className={tone(row.avgPnl)}>{yenSigned(row.avgPnl)}</td>
              <td data-numeric className={tone(row.totalPnl)}>{yenSigned(row.totalPnl)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
