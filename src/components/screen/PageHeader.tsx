import styles from './PageHeader.module.scss'

/** Screen title, a line of context under it, and a slot for screen-level controls. */
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
      {children ? <div className={styles.actions}>{children}</div> : null}
    </header>
  )
}
