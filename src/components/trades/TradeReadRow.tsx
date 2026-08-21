/**
 * One trade as a read-only table row.
 *
 * Wrapped in `memo` because the table re-renders on every pointer move while a
 * column is being dragged: without it a 250-row page rebuilt 3,000-odd cells per
 * frame for a change that only touches the `<colgroup>`.
 */
import { memo } from 'react'
import { ACCOUNT_LABEL } from './accountLabel'
import styles from './TradesTable.module.scss'
import { qty, yen } from '~/components/format'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { cx } from '~/lib/cx'
import type { TradeRow } from '~/server/trades'

export const TradeReadRow = memo(function TradeReadRow({
  row,
  onEdit,
  onDelete,
  deleting,
}: {
  row: TradeRow
  onEdit: (id: string) => void
  onDelete: (row: TradeRow) => void
  deleting: boolean
}) {
  const realized = row.realizedJpy == null ? null : Number(row.realizedJpy)

  return (
    <tr>
      <td className={styles.date}>{row.tradeDate}</td>
      <td className={styles.date}>{row.settleDate}</td>
      <td>
        <span className={styles.symbol}>{row.symbol}</span>
        <span className={styles.name}>{row.name}</span>
      </td>
      <td>
        <span className={cx(styles.badge, styles[`acct_${row.accountType}`])}>
          {ACCOUNT_LABEL[row.accountType]}
        </span>
      </td>
      <td>
        <span
          className={cx(
            styles.side,
            row.side === 'BUY' || row.side === 'REINVEST' ? styles.sideBuy : styles.sideSell,
          )}
        >
          {row.side}
        </span>
      </td>
      <td className={styles.numeric}>{qty(row.quantity)}</td>
      <td className={styles.numeric}>
        {Number(row.displayPrice).toLocaleString('en-US', { maximumFractionDigits: 4 })}
        {row.currency === 'USD' ? <span className={styles.unit}>$</span> : null}
      </td>
      <td className={styles.numeric}>{Number(row.fee) === 0 ? '—' : yen(row.fee)}</td>
      <td className={styles.numeric}>
        {row.currency === 'USD' ? Number(row.fxRate).toFixed(2) : '—'}
      </td>
      <td className={styles.numeric}>{yen(row.netAmountJpy)}</td>
      <td
        className={cx(
          styles.numeric,
          realized != null && (realized >= 0 ? styles.profit : styles.loss),
        )}
      >
        {yen(row.realizedJpy)}
      </td>
      <td
        className={cx(
          styles.numeric,
          row.returnPct != null && (row.returnPct >= 0 ? styles.profit : styles.loss),
        )}
        title={row.costJpy ? `on ${yen(row.costJpy)} cost basis` : undefined}
      >
        {row.returnPct == null
          ? '—'
          : `${row.returnPct >= 0 ? '+' : ''}${(row.returnPct * 100).toFixed(1)}%`}
      </td>
      <td>
        <div className={styles.actions}>
          {row.origin === 'MANUAL' ? (
            <span className={styles.tag} title="Hand-entered">
              manual
            </span>
          ) : null}
          {row.isEdited ? (
            <span
              className={styles.tag}
              title="Corrected by hand — no longer exactly as Rakuten reported"
            >
              edited
            </span>
          ) : null}
          {!row.isSettled ? (
            <span
              className={styles.tag}
              title="Amount derived; Rakuten had not settled this yet"
            >
              unsettled
            </span>
          ) : null}
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              onEdit(row.id)
            }}
          >
            Edit
          </button>
          <ConfirmButton
            onConfirm={() => {
              onDelete(row)
            }}
            disabled={deleting}
            className={styles.action}
            confirmLabel="Delete?"
            title="Soft delete — recoverable, and a re-import will not resurrect it"
          >
            Delete
          </ConfirmButton>
        </div>
      </td>
    </tr>
  )
})
