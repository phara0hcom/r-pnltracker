/**
 * Client entry, added solely to initialise Sentry before hydration.
 *
 * Everything below the import is a verbatim copy of Start's default client entry
 * (`@tanstack/react-start/dist/plugin/default-entry/client.tsx`). Adding this file
 * takes over an entry the framework was generating, so it has to reproduce that
 * default exactly — including hydrating `document` rather than a root element,
 * which `__root.tsx` requires because it renders `<html>` itself.
 *
 * Deliberately does not call `getRouter()`: it builds a fresh `QueryClient` and
 * router on every call, and `StartClient` creates its own. Calling it here would
 * leave two of each, with the instrumented one never navigating.
 */
import './instrument.client'
import { StartClient } from '@tanstack/react-start/client'
import { StrictMode, startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  )
})
