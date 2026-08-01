/**
 * Sign-in. Google is the only provider, and the allowlist is enforced
 * server-side — a successful Google login from another account is still refused.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import styles from './signin.module.scss'
import { signIn } from '~/lib/auth-client'
import { getSessionUser } from '~/lib/session'

export const Route = createFileRoute('/signin')({
  validateSearch: z.object({
    redirect: z.string().optional(),
    error: z.string().optional(),
  }),
  beforeLoad: async () => {
    // Already signed in — skip the form.
    const user = await getSessionUser()
    if (user) throw redirect({ to: '/dashboard' })
  },
  component: SignIn,
})

function SignIn() {
  const { redirect: redirectTo, error } = Route.useSearch()

  return (
    <div className={styles.page}>
      <main className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            ¥
          </span>
          <h1 className={styles.title}>PnL Tracker</h1>
        </div>
        <p className={styles.subtitle}>Rakuten Securities portfolio &amp; trading journal</p>

        {error ? (
          <p className={styles.error} role="alert">
            {error === 'unauthorised'
              ? 'That account is not authorised to sign in.'
              : 'Sign-in failed. Please try again.'}
          </p>
        ) : null}

        <button
          type="button"
          className={styles.googleButton}
          onClick={() => {
            void signIn.social({
              provider: 'google',
              callbackURL: redirectTo ?? '/dashboard',
            })
          }}
        >
          <GoogleMark />
          Continue with Google
        </button>

        <p className={styles.note}>Access is restricted to a single authorised account.</p>
      </main>
    </div>
  )
}

/** Inline so there is no external asset request on the sign-in page. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.98 10.72a5.41 5.41 0 0 1 0-3.44V4.96H.96a9 9 0 0 0 0 8.1l3.02-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.96L3.98 7.3C4.68 5.18 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}
