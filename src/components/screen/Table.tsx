import styles from './Table.module.scss'

/** Table in a horizontally scrollable card, so a wide table never widens the page. */
export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>{children}</table>
    </div>
  )
}
