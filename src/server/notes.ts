/**
 * Journal server functions. One entry per day; saving is an upsert.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authed } from './middleware'
import { deleteNote, upsertNote } from '~/db/notes.service'
import { setTradeJournal } from '~/db/trades.service'

const noteSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  title: z.string().trim().max(200).optional(),
  body: z.string().trim().max(10_000).optional(),
  // 1–5 so it can be correlated against that day's realized P&L.
  mood: z.number().int().min(1).max(5).nullable().optional(),
  motivation: z.number().int().min(1).max(5).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
})

const tradeJournalSchema = z.object({
  tradeId: z.string().min(1),
  memo: z.string().trim().max(2000).nullable().optional(),
  motivation: z.number().int().min(1).max(5).nullable().optional(),
})

export const saveNote = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => noteSchema.parse(data))
  .handler(async ({ data, context }) => {
    const saved = await upsertNote(context.userId, data)
    return { ok: true as const, note: saved }
  })

export const removeNote = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: { date: string }) => data)
  .handler(async ({ data, context }) => {
    await deleteNote(context.userId, data.date)
    return { ok: true as const }
  })

/**
 * Per-trade journal entry.
 *
 * Kept apart from the trade-editing path so recording how a trade felt can never
 * alter its figures or mark it as hand-corrected.
 */
export const saveTradeJournal = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: unknown) => tradeJournalSchema.parse(data))
  .handler(async ({ data, context }) => {
    await setTradeJournal(context.userId, data.tradeId, {
      memo: data.memo ?? null,
      motivation: data.motivation ?? null,
    })
    return { ok: true as const }
  })
