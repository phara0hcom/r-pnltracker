import styles from './TableToolbar.module.scss'

/**
 * The row of controls that belongs to a table: the column menu, and on SP the
 * filter button.
 *
 * Right-aligned and directly above the table at every width, so the controls
 * that change what a table shows always sit against it rather than drifting up
 * into the page header on some screens and not others.
 */
export function TableToolbar({ children }: { children: React.ReactNode }) {
  return <div className={styles.toolbar}>{children}</div>
}
