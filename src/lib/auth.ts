/**
 * Better Auth configuration.
 *
 * Single-user by design: Google is the only provider, and `ALLOWED_EMAIL` is a
 * hard allowlist checked before any account is created. A successful Google
 * sign-in from any other address is rejected — OAuth proves who you are, not
 * that you may enter.
 */
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '../db'
import { account, session, user, verification } from '../db/schema'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set — see SETUP.md`)
  }
  return value
}

/** Lowercased allowlist. Multiple addresses may be comma-separated. */
const allowedEmails = new Set(
  (process.env.ALLOWED_EMAIL ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
)

export const isAllowedEmail = (email: string | null | undefined): boolean => {
  if (!email) return false
  // An empty allowlist denies everyone rather than admitting everyone: a missing
  // env var must fail closed.
  if (allowedEmails.size === 0) return false
  return allowedEmails.has(email.toLowerCase())
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),

  secret: required('BETTER_AUTH_SECRET'),
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',

  emailAndPassword: { enabled: false },

  socialProviders: {
    google: {
      clientId: required('GOOGLE_CLIENT_ID'),
      clientSecret: required('GOOGLE_CLIENT_SECRET'),
    },
  },

  session: {
    // Long-lived: this is a personal tool, not a shared terminal.
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },

  databaseHooks: {
    user: {
      create: {
        /**
         * The allowlist gate.
         *
         * Runs before the user row is written, so a non-allowlisted Google
         * account never gets an account, a session, or a row in the database.
         */
        before: (userData) => {
          if (!isAllowedEmail(userData.email)) {
            throw new Error('This account is not authorised to sign in.')
          }
          return Promise.resolve({ data: userData })
        },
      },
    },
  },

  /**
   * Origins permitted to initiate an auth flow.
   *
   * Without this, any site can POST to `/api/auth/sign-in/social` and get a
   * valid Google URL back. That is not a data leak — no cookie is involved and
   * CORS prevents reading the response — but there is no reason to answer a
   * foreign origin at all.
   */
  trustedOrigins: [process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'],

  advanced: {
    // Vercel serves over HTTPS; local dev does not.
    useSecureCookies: process.env.NODE_ENV === 'production',
    // Explicit rather than inherited: Lax is what stops a cross-site POST from
    // carrying the session cookie, which is the primary CSRF defence here.
    defaultCookieAttributes: {
      sameSite: 'lax',
      httpOnly: true,
      path: '/',
    },
  },
})

export type Session = Awaited<ReturnType<typeof auth.api.getSession>>
