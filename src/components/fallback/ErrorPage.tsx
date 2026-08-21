import { FallbackPage } from './FallbackPage'

/** The root route's `errorComponent`. */
export function ErrorPage({ error }: { error: Error }) {
  // The message is shown because this is a single-user personal app — there is
  // no other user whose data could leak through an error string.
  return (
    <FallbackPage
      title="Something went wrong"
      message={error.message || 'An unexpected error occurred.'}
    />
  )
}
