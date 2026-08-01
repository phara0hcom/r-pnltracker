import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  // The app has no landing page; the dashboard is the entry point and the
  // `_authed` guard redirects to sign-in when there is no session.
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' })
  },
})
