import styles from './Table.module.scss'

/**
 * Table in a horizontally scrollable card, so a wide table never widens the page.
 *
 * `caption` is rendered visually hidden. A sortable table needs it: `aria-sort`
 * on a header only tells a screen reader about the column it lands on, so
 * without a caption there is nothing announcing how the table is ordered when
 * you arrive at it.
 */
export function Table({ caption, children }: { caption?: string; children: React.ReactNode }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        {caption ? <caption className="visually-hidden">{caption}</caption> : null}
        {children}
      </table>
    </div>
  )
}
