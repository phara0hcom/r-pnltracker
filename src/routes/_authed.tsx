/**
 * Auth guard layout.
 *
 * `beforeLoad` runs before any child loader, so an unauthenticated visitor is
 * redirected without a single query touching the database.
 */
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { AppShell } from '~/components/AppShell'
import { getSessionUser } from '~/lib/session'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ location }) => {
    const user = await getSessionUser()
    if (!user) {
      throw redirect({
        to: '/signin',
        // Preserved so sign-in returns to the page that was requested.
        search: { redirect: location.href },
      })
    }
    return { user }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  const { user } = Route.useRouteContext()
  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  )
}
