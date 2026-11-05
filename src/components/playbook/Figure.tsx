/** One labelled figure on a position page, in the grid `figureStyles.figures` lays out. */
import styles from './Figure.module.scss'

export { styles as figureStyles }

export function Figure({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className={styles.figure}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  )
}
