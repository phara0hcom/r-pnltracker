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

/** The exact recommendation sentence the engine already computed, unmodified. */
export function exitActionPushPayload(
  ruleId: string,
  symbol: string,
  action: ExitAction,
): ExitPushPayload {
  return {
    title: symbol,
    body: action.message,
    tag: `exit:${ruleId}`,
    data: { ruleId, actionKind: action.kind, url: '/exits' },
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
