/**
 * Generic Web Push plumbing for the browser — nothing here is specific to
 * exit rules, so a future notification type reuses it unchanged.
 */

/**
 * VAPID keys are base64url; `PushManager.subscribe` wants a `Uint8Array`
 * backed by a real `ArrayBuffer` — `Uint8Array.from` types as the wider
 * `ArrayBufferLike`, which `applicationServerKey` refuses.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes
}

/** The three fields the server needs from a `PushSubscription`. */
export interface SubscriptionPayload {
  endpoint: string
  p256dh: string
  auth: string
}

/** `PushSubscription.toJSON()` widens `keys` to an optional string map. */
export function toSubscriptionPayload(subscription: PushSubscription): SubscriptionPayload {
  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!json.endpoint || !p256dh || !auth) {
    throw new Error('push subscription is missing its endpoint or keys')
  }
  return { endpoint: json.endpoint, p256dh, auth }
}
