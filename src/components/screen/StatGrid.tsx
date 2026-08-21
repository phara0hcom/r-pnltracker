import styles from './StatGrid.module.scss'

/** Auto-filling grid of `Stat` tiles. */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className={styles.statGrid}>{children}</div>
}
