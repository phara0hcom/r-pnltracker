import { sentryTanstackStart } from '@sentry/tanstackstart-react/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig, type Plugin } from 'vite'

/**
 * Modules that must never reach the browser.
 *
 * First-party entries are the roots — everything heavy (`pg`, `drizzle-orm`,
 * `iconv-lite`) is reachable only through them, and is listed as well so a new
 * path to it is caught too.
 */
const SERVER_ONLY = [
  /\/src\/db\//,
  /\/src\/lib\/auth\.ts$/,
  /\/src\/lib\/import\/decode\.ts$/,
  // Not `better-auth`: its `dist/client` half is the browser SDK and belongs
  // in the client bundle. `src/lib/auth.ts` above is the server instance.
  /\/node_modules\/(pg|pg-pool|pg-protocol|pg-types|drizzle-orm|iconv-lite)\//,
  /*
   * Sentry's Node half, and the module-hook machinery OpenTelemetry patches with.
   *
   * `@sentry/tanstackstart-react` itself is deliberately *not* listed: it is
   * isomorphic, and the client build resolves its `browser` condition to a
   * barrel of `@sentry/react` plus two inert middleware stubs. What must never
   * appear is the server half reached under the `node` condition — `@sentry/node`
   * loads `node:module`, `node:diagnostics_channel` and `perf_hooks`, which is
   * the same shape of failure as `iconv-lite` reading `Buffer.prototype`.
   */
  /\/node_modules\/@sentry\/(node|node-core|opentelemetry|profiling-node)\//,
  /\/node_modules\/@opentelemetry\//,
  /\/node_modules\/(import-in-the-middle|require-in-the-middle|shimmer)\//,
]

/**
 * Fails the client build if server-only code lands in a browser chunk.
 *
 * This is a guard against a silent, recurring failure mode rather than a
 * hypothetical one. Start strips server-function handler bodies from the client
 * stub and drops the imports those bodies alone used — but an *exported*
 * non-server-function helper is not droppable, and Rollup preserves an imported
 * module's top-level side effects whether or not its exports are used. One
 * exported helper in `server/screens.ts` was therefore enough to put `pg`,
 * `drizzle-orm` and the database schema in the browser bundle, and `iconv-lite`
 * arrived by the same route through a `.validator()` — which legitimately runs
 * on the client. That one *crashed* the app, because `iconv-lite` reads
 * `Buffer.prototype` as it loads; the rest shipped 450 KB and said nothing.
 *
 * The cost of the leak scales with how quiet it is, so it is worth a hard
 * failure. See `docs/server-only-modules.md`.
 */
function noServerCodeInClient(): Plugin {
  return {
    name: 'pnl:no-server-code-in-client',
    applyToEnvironment: (environment) => environment.name === 'client',
    generateBundle(_options, bundle) {
      const offenders = new Map<string, string>()
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const id of Object.keys(chunk.modules)) {
          if (SERVER_ONLY.some((pattern) => pattern.test(id))) offenders.set(id, fileName)
        }
      }
      if (offenders.size === 0) return

      // First-party paths first: one of them is the root, and the hundred
      // `node_modules` files behind it are just the subtree it dragged along.
      const named = [...offenders]
        .map(([id, fileName]): [string, string] => [
          id.replace(/^.*\/(src|node_modules)\//, '$1/'),
          fileName,
        ])
        .sort(([a], [b]) => Number(a.startsWith('node_modules/')) - Number(b.startsWith('node_modules/')))
      const shown = named.slice(0, 10)
      const listing = shown.map(([id, fileName]) => `  ${id} → ${fileName}`).join('\n')
      const rest = named.length - shown.length

      this.error(
        `server-only modules reached the client bundle:\n${listing}` +
          (rest > 0 ? `\n  … and ${String(rest)} more` : '') +
          '\n\nSomething client-reachable references them outside a stripped server body. ' +
          'Move the reference into a handler, or into a module only handlers import — ' +
          'see docs/server-only-modules.md.',
      )
    },
  }
}

/*
 * Source maps are built and uploaded only when there is somewhere to upload them.
 *
 * Without a token a local `npm run build` must still work, so the plugin is
 * omitted rather than left to fail. `'hidden'` emits the maps without a
 * `//# sourceMappingURL` comment and `filesToDeleteAfterUpload` removes them
 * afterwards: this is a private financial app, and publishing maps to
 * `.output/public/assets` would serve the whole of `lib/auth.ts` and the exit-rule
 * engine to anyone who asked.
 *
 * Client maps only. Nitro re-bundles the Vite SSR output and strips
 * `sourcesContent`, so debug IDs injected during the Vite pass no longer match
 * the shipped chunk — server frames stay raw, and that is a known limitation
 * rather than something to chase.
 */
const uploadSourceMaps = process.env.SENTRY_AUTH_TOKEN !== undefined

export default defineConfig({
  server: { port: 3000 },
  build: { sourcemap: uploadSourceMaps ? 'hidden' : false },
  plugins: [
    tanstackStart(),
    ...(uploadSourceMaps
      ? [
          sentryTanstackStart({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            sourcemaps: { filesToDeleteAfterUpload: ['**/*.map'] },
          }),
        ]
      : []),
    /*
     * Pin the function region.
     *
     * The default was iad1 (Washington) — `x-vercel-id: hnd1::iad1::…` showed
     * the Tokyo edge handing every request to a function a continent away from
     * its data, at ~240ms per query.
     *
     * hnd1 puts the function next to the user rather than next to the database,
     * which is in ap-southeast-1 (Singapore) — so queries cost ~75ms rather than
     * the ~2ms co-location would give. That is a fair trade only because the
     * session cookie cache left just one query on the warm path. It is not fair
     * on a cold start, where the `pg` pool pays TCP + TLS to Singapore first.
     *
     * Co-locating properly means moving the Neon project to ap-northeast-1.
     *
     * Nitro's Vercel preset writes this into `.vc-config.json`, which takes
     * precedence over the Function Region project setting.
     */
    nitro({
      vercel: { functions: { regions: ['hnd1'] } },
      /*
       * Refuse indexing at the HTTP layer, not just in the document head.
       *
       * `__root.tsx` already sets `<meta name="robots">`, but a meta tag only
       * exists inside rendered HTML — it says nothing about a JSON server-fn
       * response, and it is invisible to anything that does not parse the
       * document. `X-Robots-Tag` covers every response of every content type.
       *
       * It is also the half of the pair that actually prevents *indexing*.
       * `robots.txt` prevents crawling, which is not the same thing: a URL
       * discovered elsewhere can still be listed without ever being fetched.
       * Neither is a defence against a scraper that simply ignores both — that
       * job belongs to the `_authed` guard and the sign-in allowlist, which is
       * why the only thing a non-compliant crawler can reach here is a login
       * page.
       */
      routeRules: {
        '/**': {
          headers: {
            'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
          },
        },
      },
    }),
    react(),
    noServerCodeInClient(),
  ],
  resolve: {
    alias: { '~': new URL('./src', import.meta.url).pathname },
  },
})
