import styles from './Section.module.scss'

/** A titled block of a screen. The description carries the domain caveats. */
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
      <div className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        {description ? <p className={styles.desc}>{description}</p> : null}
      </div>
      {children}
    </section>
  )
}
