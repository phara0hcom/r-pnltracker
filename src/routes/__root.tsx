/// <reference types="vite/client" />
import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import fallback from './__root.module.scss'
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

function Shell({ title, message }: { title: string; message: string }) {
  return (
    <div className={fallback.page}>
      <h1 className={fallback.title}>{title}</h1>
      <p className={fallback.message}>{message}</p>
      <a href="/dashboard" className={fallback.link}>
        Back to dashboard
      </a>
    </div>
  )
}

function NotFound() {
  return <Shell title="Not found" message="That page does not exist." />
}

function ErrorPage({ error }: { error: Error }) {
  // The message is shown because this is a single-user personal app — there is
  // no other user whose data could leak through an error string.
  return (
    <Shell
      title="Something went wrong"
      message={error.message || 'An unexpected error occurred.'}
    />
  )
}

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
        <Scripts />
      </body>
    </html>
  )
}
