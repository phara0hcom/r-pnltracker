/**
 * Whether this browser is subscribed to exit-rule push notifications.
 *
 * A store, like `offline/offlineStore.ts`, because the fact — permission
 * state, whether a `PushSubscription` currently exists — comes from the
 * browser rather than React, and more than one place may eventually need to
 * read it (the Settings toggle today, a sidebar badge later).
 */
import { useSyncExternalStore } from 'react'
import { toSubscriptionPayload, urlBase64ToUint8Array } from '~/lib/notifications/browser'
import { pushConfigured, vapidPublicKey } from '~/lib/notifications/vapid'
import { registerPushSubscription, unregisterPushSubscription } from '~/server/notifications'

export interface PushState {
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
  pending: boolean
  error: string | null
}

const UNSUPPORTED: PushState = {
  supported: false,
  permission: 'unsupported',
  subscribed: false,
  pending: false,
  error: null,
}

let state: PushState = UNSUPPORTED
const listeners = new Set<() => void>()

function set(next: PushState): void {
  state = next
  for (const listener of listeners) listener()
}

export function subscribePush(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getPush = (): PushState => state

/** Permission and subscriptions are per-browser — the server always renders as unsupported. */
export const getServerPush = (): PushState => UNSUPPORTED

function supportsPush(): boolean {
  return (
    pushConfigured() &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** Reads current permission/subscription state without prompting for anything. */
export async function refreshPushState(): Promise<void> {
  if (!supportsPush()) {
    set(UNSUPPORTED)
    return
  }
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  set({
    supported: true,
    permission: Notification.permission,
    subscribed: subscription !== null,
    pending: false,
    error: null,
  })
}

/** Prompts for permission if needed, then subscribes this browser. */
export async function enablePush(): Promise<void> {
  if (!supportsPush()) return
  set({ ...state, pending: true, error: null })

  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      set({ ...state, permission, pending: false })
      return
    }

    const publicKey = vapidPublicKey()
    if (publicKey === null) throw new Error('push notifications are not configured')

    const registration = await navigator.serviceWorker.ready
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }))

    await registerPushSubscription({
      data: { ...toSubscriptionPayload(subscription), userAgent: navigator.userAgent },
    })
    set({ supported: true, permission: 'granted', subscribed: true, pending: false, error: null })
  } catch (error) {
    set({ ...state, pending: false, error: error instanceof Error ? error.message : 'failed to enable' })
  }
}

/** Unsubscribes this browser and forgets its subscription server-side. */
export async function disablePush(): Promise<void> {
  if (!supportsPush()) return
  set({ ...state, pending: true, error: null })

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) {
      const { endpoint } = toSubscriptionPayload(subscription)
      await subscription.unsubscribe()
      await unregisterPushSubscription({ data: { endpoint } })
    }
    set({ ...state, subscribed: false, pending: false })
  } catch (error) {
    set({ ...state, pending: false, error: error instanceof Error ? error.message : 'failed to disable' })
  }
}

export function usePush(): PushState {
  return useSyncExternalStore(subscribePush, getPush, getServerPush)
}
