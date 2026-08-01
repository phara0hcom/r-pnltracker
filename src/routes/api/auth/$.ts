/**
 * Better Auth request handler.
 *
 * A splat route so every `/api/auth/*` path reaches Better Auth — including the
 * Google callback at `/api/auth/callback/google`, which must match the redirect
 * URI registered in Google Cloud Console exactly.
 */
import { createFileRoute } from '@tanstack/react-router'
import { auth } from '~/lib/auth'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => auth.handler(request),
      POST: ({ request }: { request: Request }) => auth.handler(request),
    },
  },
})
