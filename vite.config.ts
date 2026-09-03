import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    tanstackStart(),
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
  ],
  resolve: {
    alias: { '~': new URL('./src', import.meta.url).pathname },
  },
})
