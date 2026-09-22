/**
 * Server functions for managing this user's push subscriptions.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authed } from './middleware'
import {
  deletePushSubscription,
  listPushSubscriptions,
  savePushSubscription,
} from '~/db/notifications.service'

const subscribeSchema = z.object({
  endpoint: z.url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  userAgent: z.string().max(256).nullable(),
})

export const registerPushSubscription = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => subscribeSchema.parse(data))
  .handler(async ({ data, context }) => {
    await savePushSubscription(context.userId, data)
    return { ok: true as const }
  })

export const unregisterPushSubscription = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => z.object({ endpoint: z.url() }).parse(data))
  .handler(async ({ data, context }) => {
    await deletePushSubscription(context.userId, data.endpoint)
    return { ok: true as const }
  })

/** Just a count — Settings shows "N devices enabled", never a per-device list. */
export const countMyPushSubscriptions = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(async ({ context }): Promise<number> => {
    const rows = await listPushSubscriptions(context.userId)
    return rows.length
  })
