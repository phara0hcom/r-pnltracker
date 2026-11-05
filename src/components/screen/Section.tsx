import styles from './Section.module.scss'

/** A titled block of a screen. The description carries the domain caveats. */
export function Section({
  id,
  title,
  description,
  actions,
  children,
}: {
  /** For a link from another screen to land on this block. */
  id?: string
  title: string
  description?: React.ReactNode
  /** Controls belonging to this block rather than the screen — the column menu. */
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} className={styles.section}>
      <div className={styles.head}>
        <div className={styles.heading}>
          <h2 className={styles.title}>{title}</h2>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
        {description ? <p className={styles.desc}>{description}</p> : null}
      </div>
      {children}
    </section>
  )
}
