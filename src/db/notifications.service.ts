/**
 * Storage for push subscriptions and each exit plan's last-notified action.
 *
 * Split from `exit.service.ts` because neither table describes the exit-rule
 * framework itself — one is a device capability, the other is a comparison
 * memo the notifier reads and writes and `assess()` never sees. See the two
 * tables' own headers in `schema.ts`.
 */
import { and, eq } from 'drizzle-orm'
import { exitActionState, pushSubscriptions } from './schema'
import { db } from './index'
import type { ExitActionKind } from '~/lib/exit/types'

export interface PushSubscriptionRecord {
  endpoint: string
  userId: string
  p256dh: string
  auth: string
  userAgent: string | null
  createdAt: Date
}

export interface PushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string | null
}

/** Registers a device, or refreshes its keys if the browser re-subscribed the same endpoint. */
export async function savePushSubscription(
  userId: string,
  input: PushSubscriptionInput,
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ userId, ...input })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent },
    })
}

/** Scoped to the caller, so a browser can only remove its own subscription. */
export async function deletePushSubscription(userId: string, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
}

/**
 * Unscoped removal for a subscription the push service itself has reported
 * dead (404/410) — the webhook's notify path has no session to scope this by.
 */
export async function pruneDeadSubscription(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
}

export async function listPushSubscriptions(userId: string): Promise<PushSubscriptionRecord[]> {
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
}

/** Null means this plan has never been evaluated for notification purposes. */
export async function getExitActionState(exitRuleId: string): Promise<ExitActionKind | null> {
  const [row] = await db
    .select({ lastActionKind: exitActionState.lastActionKind })
    .from(exitActionState)
    .where(eq(exitActionState.exitRuleId, exitRuleId))
  return row?.lastActionKind ?? null
}

/**
 * Advances the comparison memo.
 *
 * Never read by `assess()` — see `exitActionState`'s own header in
 * `schema.ts`. This is the only writer; nothing else touches this table.
 */
export async function recordExitActionState(
  exitRuleId: string,
  userId: string,
  kind: ExitActionKind,
): Promise<void> {
  await db
    .insert(exitActionState)
    .values({ exitRuleId, userId, lastActionKind: kind })
    .onConflictDoUpdate({
      target: exitActionState.exitRuleId,
      set: { lastActionKind: kind, updatedAt: new Date() },
    })
}
