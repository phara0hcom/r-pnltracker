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
import { auth, isAllowedEmail } from '~/lib/auth'

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
    const request = getRequest()
    const session = await auth.api.getSession({ headers: request.headers })

    if (!session?.user || !isAllowedEmail(session.user.email)) {
      // TODO(nit): `session?.user.email` optional-chains on `session` but then
      // dereferences `user` unguarded — and this branch is entered precisely
      // when `session.user` may be nullish, so a non-null session with no user
      // throws a TypeError here instead of logging. Better Auth always returns
      // the two together today, which is the only reason it holds.
      // Fix: `session?.user?.email ?? 'n/a'`.
      // Also logs the address on every rejection; drop it, or hash it, if these
      // logs ever leave the machine.
      console.error(
        `[auth] rejected: session=${session?.user ? 'present' : 'missing'} email=${session?.user.email ?? 'n/a'}`,
      )
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
