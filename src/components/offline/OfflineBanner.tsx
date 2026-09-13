/**
 * Says when the figures on screen came from the device rather than the server.
 *
 * Scoped to the current screen: each navigation starts it clean, and it clears
 * when the network returns and the screen reloads live. It is also where an
 * action that could not reach the server says so — the app has no toasts, and
 * this is the place already given to "the network is the problem".
 */
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useSyncExternalStore } from 'react'
import styles from './OfflineBanner.module.scss'
import { getOffline, getServerOffline, resetSavedCopy, subscribeOffline } from './offlineStore'
import { savedAtLabel } from '~/lib/offline/messages'

export function OfflineBanner() {
  const { savedAt, actionFailed } = useSyncExternalStore(
    subscribeOffline,
    getOffline,
    getServerOffline,
  )
  const router = useRouter()
  const queryClient = useQueryClient()

  // A new screen starts live; any saved copy behind it reports itself as it
  // loads. The initial load has no `fromLocation`, and must keep what the
  // client entry read from a saved page.
  useEffect(
    () =>
      router.subscribe('onBeforeNavigate', (event) => {
        if (event.fromLocation && event.hrefChanged) resetSavedCopy()
      }),
    [router],
  )

  // Back online with old figures showing: reload the screen rather than leave
  // them up until the next navigation.
  useEffect(() => {
    const reloadLive = () => {
      if (getOffline().savedAt === null) return
      resetSavedCopy()
      void router.invalidate()
      void queryClient.invalidateQueries()
    }
    window.addEventListener('online', reloadLive)
    return () => {
      window.removeEventListener('online', reloadLive)
    }
  }, [router, queryClient])

  // Always rendered, so a screen reader is already watching the region when a
  // message arrives; empty, it takes no space.
  return (
    <div role="status" className={styles.region}>
      {actionFailed ? (
        <p className={styles.banner}>
          {actionFailed === 'offline'
            ? 'You’re offline — that didn’t go through.'
            : 'Couldn’t reach the server — that didn’t go through.'}
        </p>
      ) : null}
      {savedAt === null ? null : (
        <p className={styles.banner}>
          Offline — showing figures saved {savedAtLabel(new Date(savedAt))}
        </p>
      )}
    </div>
  )
}
