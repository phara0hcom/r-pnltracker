/**
 * The only module that imports `web-push` — kept out of the client bundle via
 * `vite.config.ts`'s `SERVER_ONLY` list, exactly like `pg`/`iconv-lite`. See
 * `docs/server-only-modules.md`.
 *
 * Unlike `lib/observability/report.ts` and `lib/prices/providers.ts`, sending
 * here does NOT swallow its own failures. The caller needs to tell "this
 * subscription is dead, prune it" apart from "this failed transiently, leave
 * the state unresolved so the next delivery retries" — and only the real
 * error carries that distinction.
 */
import webpush from 'web-push'
import type { ExitPushPayload } from './exitActionNotice'

function vapidSubject(): string | null {
  const subject = process.env.VAPID_SUBJECT?.trim()
  return subject === undefined || subject === '' ? null : subject
}

/** Whether the server side is fully configured to send. */
export function serverPushConfigured(): boolean {
  return (
    !!process.env.VAPID_PUBLIC_KEY?.trim() &&
    !!process.env.VAPID_PRIVATE_KEY?.trim() &&
    vapidSubject() !== null
  )
}

let configured = false

/** Deferred rather than run at module scope, so an unconfigured server never throws on import. */
function ensureConfigured(): void {
  if (configured) return
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = vapidSubject()
  if (!publicKey || !privateKey || !subject) {
    throw new Error('VAPID keys are not configured')
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  configured = true
}

export interface PushRecipient {
  endpoint: string
  p256dh: string
  auth: string
}

/** True for a 404/410 — the push service has confirmed this endpoint is gone. */
export function isGoneSubscription(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return false
  const statusCode = (error).statusCode
  return statusCode === 404 || statusCode === 410
}

/**
 * Sends one notification to one device.
 *
 * Throws on any failure — a dead subscription and a transient one are both
 * real errors, and only `isGoneSubscription` on the caught value tells them
 * apart. Wrapping this in try/catch is the caller's job.
 */
export async function sendWebPush(recipient: PushRecipient, payload: ExitPushPayload): Promise<void> {
  ensureConfigured()
  await webpush.sendNotification(
    { endpoint: recipient.endpoint, keys: { p256dh: recipient.p256dh, auth: recipient.auth } },
    JSON.stringify(payload),
  )
}
