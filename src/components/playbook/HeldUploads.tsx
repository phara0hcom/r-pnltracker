/**
 * Images still on their way, or that failed: each named, with why and a retry.
 * Shown on the position page and on the dialog's last screen, which read the same
 * store, so one that failed in the dialog can be retried from the page.
 */
import { useQueryClient } from '@tanstack/react-query'
import { discardHeld, retryHeld, useHeldImages } from './heldImages'
import styles from './Images.module.scss'

export function HeldUploads({ journalId }: { journalId: string }) {
  const held = useHeldImages(journalId)
  const queryClient = useQueryClient()
  if (held.length === 0) return null
  const failed = held.some((item) => item.status === 'FAILED')
  return (
    <div className={styles.held}>
      <ul className={styles.heldList}>
        {held.map((item) => (
          <li key={item.key} className={styles.heldItem}>
            <img src={item.previewUrl} alt="" className={styles.heldPreview} />
            <div className={styles.heldText}>
              <span className={styles.heldName}>{item.name}</span>
              {item.status === 'FAILED' ? (
                <span className={styles.problem} role="alert">
                  Not uploaded: {item.problem}
                </span>
              ) : (
                <span className={styles.muted}>{item.status === 'UPLOADING' ? 'Uploading…' : 'Waiting to upload…'}</span>
              )}
            </div>
            {item.status === 'FAILED' ? (
              <div className={styles.heldActions}>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => {
                    retryHeld(journalId, item.key, () =>
                      queryClient.invalidateQueries({ queryKey: ['playbook', 'position', journalId] }),
                    )
                  }}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => {
                    discardHeld(journalId, item.key)
                  }}
                >
                  Discard
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {failed ? (
        <p className={styles.muted}>The position is saved. These images are held in this tab until it is closed or reloaded.</p>
      ) : null}
    </div>
  )
}
