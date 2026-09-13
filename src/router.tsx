import { MutationCache, QueryClient } from '@tanstack/react-query'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routerWithQueryClient } from '@tanstack/react-router-with-query'
import { routeTree } from './routeTree.gen'
import { noteActionFailed } from '~/components/offline/offlineStore'
import { isNetworkFailure } from '~/lib/offline/messages'

/** A request that failed because this device has no network at all. */
const failedOffline = (error: unknown): boolean => isNetworkFailure(error) && !navigator.onLine

export function getRouter() {
  const queryClient = new QueryClient({
    /*
     * The one place every action that could not reach the server is announced.
     * Each screen's own error handling still runs; this adds the reason, which
     * no screen knows. Not every mutation is an edit — refreshing prices saves
     * nothing — so the notice says the action failed, not that nothing was saved.
     */
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isNetworkFailure(error)) noteActionFailed(navigator.onLine ? 'unreachable' : 'offline')
      },
    }),
    defaultOptions: {
      queries: {
        // Financial figures are derived from imported history, not a live feed,
        // so they only change when data is imported or edited.
        staleTime: 5 * 60_000,
        // Protects the Finnhub free-tier quota: refetching on every tab focus
        // would burn calls for no new information.
        refetchOnWindowFocus: false,
        // Once, as before — except offline, where the worker has already said
        // there is no saved copy and waiting would only hold "Loading…" up.
        retry: (failureCount, error) => failureCount < 1 && !failedOffline(error),
        // Ask even when the browser says it is offline. The service worker
        // answers from the saved copy, and the default would leave every screen
        // that fetches through a query waiting for a network that is not coming.
        networkMode: 'offlineFirst',
        /*
         * A screen opened offline whose data was never saved goes to `ErrorPage`,
         * which says so. Left to render, several screens would show their empty
         * state — "No open positions to price" — which is a false statement, not
         * a missing one. Only when there is no data at all: a background refetch
         * that fails must not take down a screen that is showing figures.
         */
        throwOnError: (error, query) => query.state.data === undefined && failedOffline(error),
      },
      mutations: {
        // Fail, never queue. A paused edit lives only in memory, is lost on
        // reload, and could land later against data that has since changed.
        networkMode: 'always',
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
