/**
 * The centred page behind both router boundaries — not found, and errors.
 *
 * Without a component here TanStack Router falls back to a bare
 * "<p>Not Found</p>" and an unstyled error dump.
 */
import styles from './FallbackPage.module.scss'

export function FallbackPage({ title, message }: { title: string; message: string }) {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.message}>{message}</p>
      <a href="/dashboard" className={styles.link}>
        Back to dashboard
      </a>
    </div>
  )
}
