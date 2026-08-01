/**
 * Server-side session access.
 *
 * Wrapped in a server function so route `beforeLoad` guards can await the
 * session during SSR without the auth internals leaking into the client bundle.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { auth, isAllowedEmail } from './auth'

export interface SessionUser {
  id: string
  name: string
  email: string
  image: string | null
}

export const getSessionUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionUser | null> => {
    const request = getRequest()
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) return null

    // Re-check the allowlist on every request, not just at signup: revoking
    // access should take effect immediately, without deleting the account.
    if (!isAllowedEmail(session.user.email)) return null

    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    }
  },
)
