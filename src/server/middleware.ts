/**
 * Server-function middleware.
 *
 * Authentication is enforced here rather than inside each handler. Every server
 * function that touches user data composes `authed`, which supplies a typed
 * `context.userId` — so a handler that forgets the check cannot compile, instead
 * of silently serving another user's data.
 */
import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'

export interface AuthedContext {
  userId: string
  email: string
  name: string
}

/**
 * Blocks cross-site state changes.
 *
 * `SameSite=Lax` session cookies already stop a foreign origin from attaching
 * credentials to a POST, so this is defence in depth: it also rejects requests
 * arriving with an unexpected `Origin`, which covers a subdomain takeover or a
 * mixed deployment that SameSite alone does not.
 */
export const sameOrigin = createMiddleware({ type: 'function' }).server(({ next }) => {
  const request = getRequest()
  const origin = request.headers.get('origin')

  // Only mutating verbs carry CSRF risk; GETs are safe and legitimately arrive
  // without an Origin header during SSR or direct navigation.
  if (request.method !== 'GET' && origin) {
    const expected = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
    // TODO(nit): `new URL(origin)` throws on a literal `Origin: null`, which
    // sandboxed iframes and some cross-origin redirects send. The request is
    // still refused — the throw propagates — so this fails closed, but it
    // surfaces as a 500 instead of the intended rejection.
    // Fix: parse defensively and treat an unparseable Origin as a mismatch, e.g.
    //   const actual = URL.parse?.(origin)?.origin ?? null
    //   if (actual !== new URL(expected).origin) { ...reject... }
    if (new URL(origin).origin !== new URL(expected).origin) {
      console.error(
        `[auth] cross-origin POST rejected: origin=${origin} expected=${new URL(expected).origin}`,
      )
      throw new Error('Cross-origin request rejected')
    }
  }

  return next()
})

/**
 * Requires a valid session belonging to an allowlisted address.
 *
 * Composes `sameOrigin`, so `.middleware([authed])` applies both checks and
 * yields a typed context. The allowlist is re-checked on every call rather than
 * only at signup, so revoking an address takes effect immediately without
 * deleting the account.
 */
export const authed = createMiddleware({ type: 'function' })
  .middleware([sameOrigin])
  .server(async ({ next }) => {
    // Imported inside `.server()` for the same reason as in `lib/session.ts`:
    // at module scope it drags `pg` and `drizzle-orm` into the client bundle,
    // because Rollup preserves an imported module's side effects regardless of
    // whether anything it exports is used. See `docs/server-only-modules.md`.
    const { isAllowedEmail, sessionForRequest } = await import('~/lib/auth')

    const request = getRequest()
    // Shared with the `_authed` guard, which has already resolved this session
    // earlier in the same request — see `sessionForRequest`.
    const session = await sessionForRequest(request)

    if (!session?.user || !isAllowedEmail(session.user.email)) {
      /*
       * No address in the log.
       *
       * This line used to name the rejected account, under a note saying to drop
       * or hash it "if these logs ever leave the machine". They now do: Sentry's
       * console integration would turn this into a breadcrumb attached to the
       * next event, so the address would leave on the back of an unrelated error.
       * The integration is disabled server-side as well — belt and braces, since
       * the value of logging it was never more than confirming which of two
       * states applies, and `reason` still does that.
       *
       * The dereference bug the old note flagged is gone with it: `session?.user`
       * is now only read for its presence, so a non-null session with no user no
       * longer throws a TypeError in place of rejecting.
       */
      const reason = session?.user ? 'not-allowlisted' : 'no-session'
      console.error(`[auth] rejected: ${reason}`)
      throw new Error('Unauthorised')
    }

    return next({
      context: {
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name,
      } satisfies AuthedContext,
    })
  })
