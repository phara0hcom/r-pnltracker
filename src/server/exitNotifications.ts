/**
 * Detects an exit-plan recommendation change and pushes it to every device
 * subscribed for the plan's owner.
 *
 * No `createServerFn` export, for the same reason `server/engine.ts` has
 * none — see its own header. `processDelivery()` in the TradingView webhook
 * is the only caller, and it already runs after the response has gone out, so
 * every failure here has to report itself rather than propagate.
 */
import type Decimal from 'decimal.js'
import { engineFor } from './engine'
import { evaluateExitRule, positionsByPool } from './exitPosition'
import { barsFor, getExitSettings, listExitRulesForInstrument, type ExitRuleRecord } from '~/db/exit.service'
import {
  getExitActionState,
  listPushSubscriptions,
  pruneDeadSubscription,
  recordExitActionState,
  type PushSubscriptionRecord,
} from '~/db/notifications.service'
import { openEntryStreaks, type EntryStreak } from '~/lib/exit/entry'
import type { ExitSettings, FeedBar } from '~/lib/exit/types'
import { actionChanged, exitActionPushPayload } from '~/lib/notifications/exitActionNotice'
import { isGoneSubscription, sendWebPush, serverPushConfigured } from '~/lib/notifications/webpush'
import { reportError } from '~/lib/observability/report'

/**
 * Re-evaluates every live plan against one instrument and pushes a
 * notification for each whose recommendation changed since it was last seen.
 *
 * Grouped by owning user so `engineFor`/settings/subscriptions/bars are each
 * loaded once per user rather than once per plan — this is a single-user app
 * today, so in practice that means once per delivery.
 */
export async function notifyExitActionChanges(instrumentId: string): Promise<void> {
  const rules = await listExitRulesForInstrument(instrumentId)
  if (rules.length === 0) return

  const byUser = new Map<string, ExitRuleRecord[]>()
  for (const rule of rules) {
    const bucket = byUser.get(rule.userId)
    if (bucket) bucket.push(rule)
    else byUser.set(rule.userId, [rule])
  }

  for (const [userId, userRules] of byUser) {
    try {
      await notifyForUser(userId, userRules, instrumentId)
    } catch (error) {
      // No `userId` in the tags: `scrub.ts` strips the SDK's `user` context
      // specifically so a report never names the (one) user, and tags pass
      // through unscrubbed — putting it here would reopen that.
      reportError(error, { instrumentId, phase: 'notify-user' })
    }
  }
}

async function notifyForUser(
  userId: string,
  rules: ExitRuleRecord[],
  instrumentId: string,
): Promise<void> {
  const sendingEnabled = serverPushConfigured()

  const [{ trades, engine }, settings, subscriptions, bars] = await Promise.all([
    engineFor(userId),
    getExitSettings(userId),
    sendingEnabled ? listPushSubscriptions(userId) : Promise.resolve([]),
    barsFor([instrumentId]),
  ])

  const heldBy = positionsByPool(engine.positions)
  const streaks = openEntryStreaks(trades)
  const instrumentBars = bars.get(instrumentId) ?? []
  const now = new Date()

  for (const rule of rules) {
    // Isolated per rule: one instrument can carry two independent plans (特定
    // and NISA are separate pools), and a transient failure evaluating or
    // notifying one must not skip every rule after it in this same delivery —
    // that would silently defer a change, possibly a stop-out, to tomorrow.
    try {
      await notifyForRule(rule, userId, { heldBy, streaks, instrumentBars, settings, now, subscriptions })
    } catch (error) {
      reportError(error, { ruleId: rule.id, instrumentId, phase: 'notify-rule' })
    }
  }
}

interface RuleContext {
  heldBy: Map<string, Decimal>
  streaks: Map<string, EntryStreak>
  instrumentBars: FeedBar[]
  settings: ExitSettings
  now: Date
  subscriptions: PushSubscriptionRecord[]
}

async function notifyForRule(
  rule: ExitRuleRecord,
  userId: string,
  { heldBy, streaks, instrumentBars, settings, now, subscriptions }: RuleContext,
): Promise<void> {
  const { result } = evaluateExitRule(rule, heldBy, streaks, instrumentBars, settings, now)

  const previous = await getExitActionState(rule.id)
  if (!actionChanged(previous, result.action.kind)) {
    // Still worth recording a first-ever observation, so a later real change
    // has something to diff against.
    if (previous === null) await recordExitActionState(rule.id, userId, result.action.kind)
    return
  }

  if (subscriptions.length === 0) {
    // Nothing to notify — advance anyway, there is no one to retry for, and
    // the Exits screen already shows the current recommendation regardless.
    await recordExitActionState(rule.id, userId, result.action.kind)
    return
  }

  const payload = exitActionPushPayload(rule.id, rule.symbol, result.action)
  let delivered = false
  for (const subscription of subscriptions) {
    try {
      await sendWebPush(subscription, payload)
      delivered = true
    } catch (error) {
      if (isGoneSubscription(error)) {
        // Its own try/catch: one dead subscription must not stop the loop
        // from reaching the next device, or from recording a later success.
        try {
          await pruneDeadSubscription(subscription.endpoint)
        } catch (pruneError) {
          reportError(pruneError, { ruleId: rule.id, phase: 'prune-subscription' })
        }
      } else {
        reportError(error, { ruleId: rule.id, phase: 'send-push' })
      }
    }
  }

  // Advance the memo only once at least one device actually got the
  // notification. A total failure leaves it unresolved so the next
  // delivery's diff retries, rather than silently dropping the change.
  if (delivered) await recordExitActionState(rule.id, userId, result.action.kind)
}
