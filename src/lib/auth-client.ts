/**
 * Browser-side auth client.
 *
 * `baseURL` is left unset so it resolves relative to the current origin — that
 * way the same build works on localhost and on Vercel without rebuilding.
 */
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient()
export const { signIn, signOut, useSession } = authClient
