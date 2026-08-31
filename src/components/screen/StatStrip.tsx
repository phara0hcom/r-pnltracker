import styles from './StatStrip.module.scss'

/** Row of demoted figures beside a `HeroStat`, replacing a `StatGrid` on a redesigned screen. */
export function StatStrip({ children }: { children: React.ReactNode }) {
  return <div className={styles.strip}>{children}</div>
}
