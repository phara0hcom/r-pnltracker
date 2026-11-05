/**
 * Bookmarks and notifications sent before the Exit Rules screen went still name
 * `/exits`, so it has to land, and carry the account switch with it.
 */
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { playbookSearchSchema } from '~/lib/playbookSearch'
import { Route } from '~/routes/_authed/exits'

async function land(from: string) {
  const root = createRootRoute()
  const exits = Route.update({ id: '/_authed/exits', path: '/exits', getParentRoute: () => root } as never)
  const playbook = createRoute({
    getParentRoute: () => root,
    path: '/playbook',
    validateSearch: playbookSearchSchema,
    component: () => <p>Playbook</p>,
  })
  root.addChildren([exits, playbook])
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [from] }) })
  render(<RouterProvider router={router} />)
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/playbook')
  })
  return router
}

describe('/exits', () => {
  it('redirects to the Playbook', async () => {
    const router = await land('/exits')
    expect(router.state.location.search).toEqual({})
  })

  it('keeps the search the Playbook understands', async () => {
    const router = await land('/exits?scope=NISA&market=US')
    expect(router.state.location.search).toEqual({ scope: 'NISA', market: 'US' })
  })

  it('drops what it does not, and survives a bad value', async () => {
    const router = await land('/exits?viewing=r1&scope=nonsense')
    expect(router.state.location.search).not.toHaveProperty('viewing')
    expect(router.state.location.pathname).toBe('/playbook')
  })
})
