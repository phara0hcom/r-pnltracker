import { FallbackPage } from './FallbackPage'

/** The root route's `notFoundComponent`. */
export function NotFound() {
  return <FallbackPage title="Not found" message="That page does not exist." />
}
