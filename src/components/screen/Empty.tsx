import styles from './Empty.module.scss'

/** Placeholder for a section with nothing to show, explaining why. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className={styles.empty}>{children}</p>
}
