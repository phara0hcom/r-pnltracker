/**
 * Sign-in. Google is the only provider, and the allowlist is enforced
 * server-side — a successful Google login from another account is still refused.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import styles from './signin.module.scss'
import { GoogleMark } from '~/components/icons/GoogleMark'
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
