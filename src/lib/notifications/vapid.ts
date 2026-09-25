/**
 * The half of VAPID configuration safe to ask from the client.
 *
 * Split from `webpush.ts`, which is the only module allowed to import the
 * `web-push` package (Node-only — it cannot resolve in a browser). Unlike
 * `webhookSecretUsable` in `lib/exit/webhook.ts` — one predicate over one env
 * var, read by both the route and the screen that reports on it — this file
 * and `webpush.ts`'s `serverPushConfigured()` check four *separately*
 * configured env vars (`VITE_VAPID_PUBLIC_KEY` here; `VAPID_PUBLIC_KEY` /
 * `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` there). Nothing enforces that the two
 * halves agree — that's on whoever sets `.env` (see `.env.example`) — so it's
 * possible for `pushConfigured()` to say yes here while the server can't
 * actually send: `notifyForUser` in `server/exitNotifications.ts` treats that
 * case as "no subscriptions to notify" rather than an error.
 */

/** The client half — must carry `VITE_` to be inlined into the browser bundle. */
export function vapidPublicKey(): string | null {
  const configured = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim()
  return configured === undefined || configured === '' ? null : configured
}

/** Whether the client can attempt to subscribe at all. */
export function pushConfigured(): boolean {
  return vapidPublicKey() !== null
}
