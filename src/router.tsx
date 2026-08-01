import { QueryClient } from '@tanstack/react-query'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routerWithQueryClient } from '@tanstack/react-router-with-query'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Financial figures are derived from imported history, not a live feed,
        // so they only change when data is imported or edited.
        staleTime: 5 * 60_000,
        // Protects the Finnhub free-tier quota: refetching on every tab focus
        // would burn calls for no new information.
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  })

  return routerWithQueryClient(
    createTanStackRouter({
      routeTree,
      context: { queryClient },
      defaultPreload: 'intent',
      scrollRestoration: true,
    }),
    queryClient,
  )
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
