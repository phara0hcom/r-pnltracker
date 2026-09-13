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
import { VitalsAlarm } from '~/components/VitalsAlarm'
import { RENDERED_AT_META } from '~/lib/offline/messages'
import appCss from '~/styles/globals.scss?url'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  /*
   * When the server rendered this page, carried in the page itself.
   *
   * A loader rather than `Date.now()` inside `head`, which runs again in the
   * browser: the client would render a different time into the same tag and
   * hydration would not match. Loader data travels with the page, so both sides
   * render the server's value. How it is read: `savedPageTime`.
   */
  loader: () => ({ renderedAt: Date.now() }),
  head: ({ loaderData }) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'PnL Tracker' },
      // Personal financial data — never index, never send a referrer.
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'referrer', content: 'no-referrer' },
      { name: 'color-scheme', content: 'dark' },
      // The installed app's title bar, and the tab bar on Android. `--color-bg`.
      { name: 'theme-color', content: '#0b0d10' },
      { name: 'apple-mobile-web-app-title', content: 'PnL Tracker' },
      ...(loaderData ? [{ name: RENDERED_AT_META, content: String(loaderData.renderedAt) }] : []),
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      // Drawn by `npm run icons` from one definition of the sidebar's mark.
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
    ],
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
        <VitalsAlarm />
        <Scripts />
      </body>
    </html>
  )
}
