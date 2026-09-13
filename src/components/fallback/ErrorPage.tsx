import { captureException } from '@sentry/tanstackstart-react'
import { useEffect, useState } from 'react'
import { FallbackPage } from './FallbackPage'
import { reloadScreen, useOnline } from '~/components/offline/offlineStore'
import { isNetworkFailure } from '~/lib/offline/messages'

/** The root route's `errorComponent`. */
export function ErrorPage({ error }: { error: Error }) {
  /*
   * Reported here because nothing else reports it.
   *
   * A router `errorComponent` is not an error boundary Sentry wraps — the SDK
   * captures unhandled exceptions and its own boundary, not this. So until now
   * this component was the entire response to a failed loader or a render crash:
   * it drew a message and the error was gone. On a phone that meant no trace at
   * all.
   *
   * Keyed on `error` rather than mounting once: navigating from one failure to a
   * different one reuses this component, and the second error would otherwise
   * never be sent.
   */
  useEffect(() => {
    captureException(error)
  }, [error])

  const online = useOnline()
  const networkFailure = isNetworkFailure(error)
  const [reconnecting, setReconnecting] = useState(false)

  /*
   * Back online, open the screen again rather than leave a dead end.
   *
   * A full reload rather than `router.invalidate()`: the failure may be a
   * loader's or a query's thrown by `throwOnError`, and a reload starts both
   * over — through the worker, so a connection that drops again still finds a
   * saved copy. Keyed on the kind of failure, not on `online`: the flag flips in
   * the same event, and a listener removed by that re-render would never run.
   */
  useEffect(() => {
    if (!networkFailure) return
    const reconnect = () => {
      setReconnecting(true)
      reloadScreen()
    }
    window.addEventListener('online', reconnect)
    return () => {
      window.removeEventListener('online', reconnect)
    }
  }, [networkFailure])

  // The flag is already back while the reload runs, and "Failed to fetch" would
  // be the wrong thing to show in the meantime.
  if (networkFailure && reconnecting) {
    return <FallbackPage title="Reconnecting…" message="Opening this screen again." />
  }

  // Opening a screen offline that was never saved fails in its loader or its
  // first query (see `throwOnError` in `router.tsx`). Nothing went wrong, and
  // "Failed to fetch" would not say what did happen.
  if (networkFailure && !online) {
    return (
      <FallbackPage
        title="You’re offline"
        message="This screen hasn’t been saved on this device yet. Screens are saved each time you open them with a connection."
        onRetry={reloadScreen}
      />
    )
  }

  // The message is shown because this is a single-user personal app — there is
  // no other user whose data could leak through an error string.
  return (
    <FallbackPage
      title="Something went wrong"
      message={error.message || 'An unexpected error occurred.'}
      onRetry={networkFailure ? reloadScreen : undefined}
    />
  )
}
