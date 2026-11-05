/**
 * Whether an exit plan's recommendation changed, and what to tell the user if
 * it did.
 *
 * Pure and DB-free like the rest of `lib/exit/` — the diff itself is one
 * inequality, but naming and testing it here is what keeps
 * `server/exitNotifications.ts` free of a null-baseline bug: seeding a plan's
 * very first observation must never read as "changed from nothing".
 */
import type { ExitAction, ExitActionKind } from '../exit/types'

/**
 * True only when there was a real prior observation and it differs from the
 * current one.
 *
 * `previous === null` means this plan has never been evaluated before —
 * either it predates this feature, or its first webhook bar just arrived —
 * and both cases should seed the baseline silently rather than notify.
 * Without this, shipping the feature would fire once for every open plan, and
 * every newly created plan would notify on its first-ever bar.
 */
export function actionChanged(previous: ExitActionKind | null, current: ExitActionKind): boolean {
  return previous !== null && previous !== current
}

export interface ExitPushPayload {
  title: string
  body: string
  /** Collapses a same-plan re-delivery into one OS notification rather than stacking. */
  tag: string
  data: { ruleId: string; actionKind: ExitActionKind; url: string }
}

/** Where a notification lands when it has no position to name. */
export const NOTIFICATION_FALLBACK_URL = '/playbook'

/**
 * The position a plan belongs to, or the Playbook for a plan from before there
 * were positions: it has none until the owner files it, and it still pushes.
 */
export function exitNotificationUrl(journalId: string | null): string {
  return journalId === null ? NOTIFICATION_FALLBACK_URL : `/playbook/${encodeURIComponent(journalId)}`
}

/** The exact recommendation sentence the engine already computed, unmodified. */
export function exitActionPushPayload(
  ruleId: string,
  symbol: string,
  action: ExitAction,
  journalId: string | null,
): ExitPushPayload {
  return {
    title: symbol,
    body: action.message,
    tag: `exit:${ruleId}`,
    data: { ruleId, actionKind: action.kind, url: exitNotificationUrl(journalId) },
  }
}

/** Defensive parse for the service worker's `push` handler — never throws. */
export function parseExitPushPayload(raw: unknown): ExitPushPayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { title, body, tag, data } = raw as Record<string, unknown>
  if (typeof title !== 'string' || typeof body !== 'string' || typeof tag !== 'string') return null
  if (typeof data !== 'object' || data === null) return null

  const { ruleId, actionKind, url } = data as Record<string, unknown>
  if (typeof ruleId !== 'string' || typeof actionKind !== 'string' || typeof url !== 'string') {
    return null
  }

  return { title, body, tag, data: { ruleId, actionKind: actionKind as ExitActionKind, url } }
}

/**
 * Which open window a notification click should use, if any.
 *
 * A window already on that screen is only brought forward. Otherwise one is sent
 * there, because the app is one screen per window: a notification for a second
 * position used to open a second window beside the first. The window in front is
 * the one the owner is looking at, so it goes before any other.
 */
export function windowForNotification<Client extends { url: string; focused: boolean }>(
  clients: readonly Client[],
  url: string,
): { client: Client; navigate: boolean } | null {
  const already = clients.find((client) => new URL(client.url).pathname === url)
  if (already) return { client: already, navigate: false }
  const other = clients.find((client) => client.focused) ?? clients[0]
  return other ? { client: other, navigate: true } : null
}
