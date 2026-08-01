/**
 * Shared screen chrome: heading, stat tiles, section cards, meters.
 * Kept in one place so every analysis screen reads as the same system.
 */
import styles from './Screen.module.scss'
import { cx } from '~/lib/cx'

export function PageHeader({
  title,
  meta,
  children,
}: {
  title: string
  meta?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        {meta ? <p className={styles.meta}>{meta}</p> : null}
      </div>
      {children ? <div className={styles.headerActions}>{children}</div> : null}
    </header>
  )
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className={styles.statGrid}>{children}</div>
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'profit' | 'loss' | 'flat'
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span
        className={cx(
          styles.statValue,
          tone === 'profit' && styles.profit,
          tone === 'loss' && styles.loss,
        )}
      >
        {value}
      </span>
      {hint ? <span className={styles.statHint}>{hint}</span> : null}
    </div>
  )
}

export function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {description ? <p className={styles.sectionDesc}>{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * Horizontal progress meter.
 *
 * `max` is the cap being measured against; overflow is clamped visually but the
 * caller still shows the true figure, so a maxed quota reads as full rather
 * than as a bar running off the end.
 */
export function Meter({
  value,
  max,
  label,
  caption,
  tone = 'accent',
}: {
  value: number
  max: number
  label: string
  caption?: React.ReactNode
  tone?: 'accent' | 'profit' | 'warn'
}) {
  const fraction = max > 0 ? Math.min(value / max, 1) : 0
  return (
    <div className={styles.meterRow}>
      <div className={styles.meterHead}>
        <span className={styles.meterLabel}>{label}</span>
        {caption ? <span className={styles.meterCaption}>{caption}</span> : null}
      </div>
      <div
        className={styles.meterTrack}
        role="meter"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={cx(styles.meterFill, styles[`meter_${tone}`])}
          style={{ width: `${String(fraction * 100)}%` }}
        />
      </div>
    </div>
  )
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>{children}</table>
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className={styles.empty}>{children}</p>
}
