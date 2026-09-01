/**
 * One trade as a read-only table row.
 *
 * Wrapped in `memo` because the table re-renders on every pointer move while a
 * column is being dragged: without it a 250-row page rebuilt 3,000-odd cells per
 * frame for a change that only touches the `<colgroup>`.
 */
import { memo, useRef } from 'react'
import { ACCOUNT_LABEL } from './accountLabel'
import styles from './TradesTable.module.scss'
import { qty, yen } from '~/components/format'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { useLongPress } from '~/components/ui/useLongPress'
import { cx } from '~/lib/cx'
import type { TradeRow } from '~/server/trades'

export const TradeReadRow = memo(function TradeReadRow({
  row,
  visible,
  onReveal,
  onEdit,
  onDelete,
  deleting,
}: {
  row: TradeRow
  /**
   * Which columns to render. Memoised by `useColumnVisibility` against a
   * module-level list, so it keeps its identity through a resize drag and the
   * `memo` above still holds.
   */
  visible: ReadonlySet<string>
  /**
   * Hands the pressed name to the table's single shared popover.
   *
   * One popover for the whole table rather than one per row: a page holds up to
   * 250 rows, and 250 `Popover.Root`s is real weight on a component memoised
   * specifically to survive a column drag. The long-press hook is cheap — refs
   * and callbacks — so that part stays per row.
   */
  onReveal: (anchor: HTMLElement, name: string) => void
  onEdit: (id: string) => void
  onDelete: (row: TradeRow) => void
  deleting: boolean
}) {
  const realized = row.realizedJpy == null ? null : Number(row.realizedJpy)

  /*
   * Funds carry no ticker, so their symbol *is* their name. The first line then
   * holds the long string and the second would repeat it, so the name line is
   * dropped and the reveal moves up to the symbol.
   */
  const selfNamed = row.name === row.symbol

  const nameRef = useRef<HTMLSpanElement>(null)
  const { handlers } = useLongPress(() => {
    if (nameRef.current) onReveal(nameRef.current, row.name)
  })

  return (
    <tr>
      {visible.has('tradeDate') && <td className={styles.date}>{row.tradeDate}</td>}
      {visible.has('settleDate') && <td className={styles.date}>{row.settleDate}</td>}
      {visible.has('symbol') && (
        <td>
          {selfNamed ? (
            <span ref={nameRef} className={styles.symbol} title={row.symbol} {...handlers}>
              {row.symbol}
            </span>
          ) : (
            <>
              <span className={styles.symbol}>{row.symbol}</span>
              <span ref={nameRef} className={styles.name} title={row.name} {...handlers}>
                {row.name}
              </span>
            </>
          )}
        </td>
      )}
      {visible.has('account') && (
        <td>
          <span className={cx(styles.badge, styles[`acct_${row.accountType}`])}>
            {ACCOUNT_LABEL[row.accountType]}
          </span>
        </td>
      )}
      {visible.has('side') && (
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
      )}
      {visible.has('quantity') && <td className={styles.numeric}>{qty(row.quantity)}</td>}
      {visible.has('price') && (
        <td className={styles.numeric}>
          {Number(row.displayPrice).toLocaleString('en-US', { maximumFractionDigits: 4 })}
          {row.currency === 'USD' ? <span className={styles.unit}>$</span> : null}
        </td>
      )}
      {visible.has('fee') && <td className={styles.numeric}>{Number(row.fee) === 0 ? '—' : yen(row.fee)}</td>}
      {visible.has('fx') && (
        <td className={styles.numeric}>
          {row.currency === 'USD' ? Number(row.fxRate).toFixed(2) : '—'}
        </td>
      )}
      {visible.has('amount') && <td className={styles.numeric}>{yen(row.netAmountJpy)}</td>}
      {visible.has('realized') && (
        <td
          className={cx(
            styles.numeric,
            realized != null && (realized >= 0 ? styles.profit : styles.loss),
          )}
        >
          {yen(row.realizedJpy)}
        </td>
      )}
      {visible.has('returnPct') && (
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
      )}
      {visible.has('actions') && (
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
      )}
    </tr>
  )
})
