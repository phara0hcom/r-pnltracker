import { captureException } from '@sentry/tanstackstart-react'
import { useEffect } from 'react'
import { FallbackPage } from './FallbackPage'

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

  // The message is shown because this is a single-user personal app — there is
  // no other user whose data could leak through an error string.
  return (
    <FallbackPage
      title="Something went wrong"
      message={error.message || 'An unexpected error occurred.'}
    />
  )
}
