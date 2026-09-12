/**
 * Server entry, added solely to initialise Sentry before anything handles a
 * request.
 *
 * Vercel offers no way to set `NODE_OPTIONS='--import ...'` for a Nitro-built
 * function, so the side-effect import below is the serverless install path from
 * Sentry's docs. It must stay the first statement in the file.
 *
 * This file is the SSR rollup input and is not in the client graph, which is what
 * makes it the right home for `instrument.server` — see `docs/server-only-modules.md`.
 *
 * `createServerEntry` does not build the handler; it only types and returns the
 * `{ fetch }` object, so the handler has to be constructed here exactly as
 * Start's own default entry does it.
 */
import './instrument.server'
import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { createServerEntry } from '@tanstack/react-start/server-entry'

export default createServerEntry({ fetch: createStartHandler(defaultStreamHandler) })
