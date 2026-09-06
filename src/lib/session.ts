/**
 * Server-side session access.
 *
 * Wrapped in a server function so route `beforeLoad` guards can await the
 * session during SSR without the auth internals leaking into the client bundle.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'

export interface SessionUser {
  id: string
  name: string
  email: string
  image: string | null
}

export const getSessionUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionUser | null> => {
    // Imported inside the handler, never at module scope.
    //
    // Start strips this body from the client build, but a top-level import
    // survives that: Rollup keeps an imported module's top-level side effects
    // even when none of its exports are used. `lib/auth` reaches `db/index.ts`,
    // which opens a `pg` pool as a side effect — so a static import here put the
    // whole of `pg`, `drizzle-orm` and the database schema in the browser
    // bundle. See `docs/server-only-modules.md`.
    const { isAllowedEmail, sessionForRequest } = await import('./auth')

    const request = getRequest()
    // Memoised per request: this runs in `_authed.beforeLoad`, and the `authed`
    // middleware asks for the same session again a moment later.
    const session = await sessionForRequest(request)
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
