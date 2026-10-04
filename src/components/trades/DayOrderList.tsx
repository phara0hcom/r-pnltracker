/**
 * One day's trades, reorderable into the order they actually happened.
 *
 * Rakuten exports carry no execution time, so the engine's default within a
 * day is opens-first — which averages buy 29, sell 20, buy 2, sell 11 as if all
 * 31 shares were bought before either sale. Shared by the calendar day dialog
 * and the import preview, so the two cannot disagree about what ordering means.
 *
 * Up/down buttons rather than drag: they work by keyboard and on a phone, and
 * a day rarely holds more than a handful of trades.
 */
import styles from './DayOrderList.module.scss'
import { ACCOUNT_LABEL, qty } from '~/components/format'
import { cx } from '~/lib/cx'

export interface DayOrderItem {
  id: string
  symbol: string
  accountType: string
  side: 'BUY' | 'SELL' | 'REINVEST' | 'REDEEM'
  quantity: string
  /** Already formatted, currency included. */
  price: string
  /** Marks a row the pending import would add. */
  isNew?: boolean
}

export function DayOrderList<T extends DayOrderItem>({
  items,
  onChange,
  label,
  showAccount = true,
}: {
  items: T[]
  onChange: (next: T[]) => void
  /** Names the list for screen readers, e.g. the date. */
  label: string
  /** Off when every row is in one account, where the column repeats itself. */
  showAccount?: boolean
}) {
  const move = (from: number, to: number) => {
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved!)
    onChange(next)
  }

  return (
    <ol className={cx(styles.list, !showAccount && styles.oneAccount)} aria-label={label}>
      {items.map((item, index) => {
        const isOpen = item.side === 'BUY' || item.side === 'REINVEST'
        const name = `${item.side} ${qty(item.quantity)} ${item.symbol}`
        return (
          <li key={item.id} className={styles.row}>
            <span className={styles.position}>{index + 1}</span>
            {/* One cell per field on a desktop; two lines on a phone. */}
            <span className={styles.what}>
              <span className={cx(styles.side, isOpen ? styles.sideBuy : styles.sideSell)}>
                {item.side}
              </span>
              <span className={styles.symbol}>{item.symbol}</span>
              {showAccount ? (
                <span className={styles.account}>
                  {ACCOUNT_LABEL[item.accountType] ?? item.accountType}
                </span>
              ) : null}
              <span className={styles.size}>
                {qty(item.quantity)} @ {item.price}
              </span>
              {item.isNew ? <span className={styles.tag}>new</span> : <span />}
            </span>
            <span className={styles.moves}>
              <button
                type="button"
                className={styles.move}
                disabled={index === 0}
                aria-label={`Move ${name} earlier`}
                onClick={() => {
                  move(index, index - 1)
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.move}
                disabled={index === items.length - 1}
                aria-label={`Move ${name} later`}
                onClick={() => {
                  move(index, index + 1)
                }}
              >
                ↓
              </button>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
