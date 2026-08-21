/// <reference types="vite/client" />
import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import { ErrorPage } from '~/components/fallback/ErrorPage'
import { NotFound } from '~/components/fallback/NotFound'
import { VercelInsights } from '~/components/VercelInsights'
import appCss from '~/styles/globals.scss?url'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'PnL Tracker' },
      // Personal financial data — never index, never send a referrer.
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'referrer', content: 'no-referrer' },
      { name: 'color-scheme', content: 'dark' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootDocument,
  // Without these, TanStack Router falls back to a bare "<p>Not Found</p>" and
  // an unstyled error dump.
  notFoundComponent: NotFound,
  errorComponent: ErrorPage,
})

function RootDocument() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Outlet />
        <VercelInsights />
        <Scripts />
      </body>
    </html>
  )
}
