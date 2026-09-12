/// <reference types="vite/client" />

/**
 * Types the environment variables this app reads in the browser.
 *
 * `vite/client` declares `ImportMetaEnv` with an `any` index signature, so an
 * unaugmented `import.meta.env.VITE_SENTRY_DSN` is `any` — and
 * `@typescript-eslint/no-unsafe-assignment` is an error here, correctly: an `any`
 * flowing into `Sentry.init` is exactly the seam where a typo becomes a silent
 * no-DSN deployment.
 *
 * Optional, not required: an unset DSN disables reporting rather than failing.
 */
interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string
}
