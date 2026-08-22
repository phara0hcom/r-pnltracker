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
    nitro({ vercel: { functions: { regions: ['hnd1'] } } }),
    react(),
  ],
  resolve: {
    alias: { '~': new URL('./src', import.meta.url).pathname },
  },
})
