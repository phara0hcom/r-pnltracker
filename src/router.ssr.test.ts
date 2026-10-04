/**
 * A server render of a screen that creates a query, through the real router.
 *
 * Nothing else renders one on the server: the component tests do not, and
 * `check:offline` server-renders only `/signin`, which creates no query. That
 * is how upgrading the router past what `@tanstack/react-router-with-query`
 * supported went unnoticed — its query listener called a `serverSsr` method
 * router-core had removed, every such render threw, and React quietly left
 * those screens to be drawn in the browser instead.
 *
 * `getRouter()` is used as the app builds it, with the route tree swapped for
 * one screen that calls `useQuery`, so the query integration under test is
 * whichever one `router.tsx` actually wires up.
 */
import { defaultStreamHandler } from '@tanstack/react-router/ssr/server'
import { createRequestHandler } from '@tanstack/router-core/ssr/server'
import { afterEach, expect, it, vi } from 'vitest'
import { getRouter } from './router'

vi.mock('./routeTree.gen', async () => {
  const { createRootRoute, createRoute, HeadContent, Outlet, Scripts } = await import('@tanstack/react-router')
  const { useQuery } = await import('@tanstack/react-query')
  const { createElement: h } = await import('react')

  const root = createRootRoute({
    component: () => h('html', null, h('head', null, h(HeadContent)), h('body', null, h(Outlet), h(Scripts))),
  })
  const screen = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: function Screen() {
      const { status } = useQuery({ queryKey: ['figures'], queryFn: () => Promise.resolve(1) })
      return h('p', null, `screen rendered, query ${status}`)
    },
  })
  return { routeTree: root.addChildren([screen]) }
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('server-renders a screen that creates a query', async () => {
  // A render React abandons is reported here, not thrown.
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

  const handle = createRequestHandler({ request: new Request('http://localhost/'), createRouter: getRouter })
  const html = await (await handle(defaultStreamHandler)).text()

  expect(consoleError).not.toHaveBeenCalled()
  // React's marker for a boundary it gave up on and left to the browser.
  expect(html).not.toContain('<!--$!-->')
  expect(html).toContain('screen rendered, query pending')
})
