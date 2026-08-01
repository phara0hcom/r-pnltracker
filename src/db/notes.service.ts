/**
 * Journal entries — one per day, carrying mood and motivation.
 *
 * The unique index on (userId, date) makes the calendar unambiguous: a day has
 * at most one entry, so writing is an upsert rather than an insert-or-update
 * dance that could race.
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { idFor } from './mappers'
import { notes } from './schema'
import { db } from './index'

export interface NoteRecord {
  id: string
  date: string
  title: string
  body: string
  /** 1–5, or null when not recorded. */
  mood: number | null
  motivation: number | null
  tags: string[]
}

export async function listNotes(
  userId: string,
  from?: string,
  to?: string,
): Promise<NoteRecord[]> {
  const conditions = [eq(notes.userId, userId)]
  if (from) conditions.push(gte(notes.date, from))
  if (to) conditions.push(lte(notes.date, to))

  const rows = await db
    .select()
    .from(notes)
    .where(and(...conditions))
    .orderBy(asc(notes.date))

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    title: r.title,
    body: r.body,
    mood: r.mood,
    motivation: r.motivation,
    tags: r.tags,
  }))
}

export interface NoteInput {
  date: string
  title?: string
  body?: string
  mood?: number | null
  motivation?: number | null
  tags?: string[]
}

/**
 * Create or replace the entry for a day.
 *
 * The id is derived from (userId, date) so the upsert target is stable — the
 * same day always writes the same row rather than accumulating duplicates.
 */
export async function upsertNote(userId: string, input: NoteInput): Promise<NoteRecord> {
  const id = idFor('note', userId, input.date)
  const values = {
    id,
    userId,
    date: input.date,
    title: input.title ?? '',
    body: input.body ?? '',
    mood: input.mood ?? null,
    motivation: input.motivation ?? null,
    tags: input.tags ?? [],
  }

  const [row] = await db
    .insert(notes)
    .values(values)
    .onConflictDoUpdate({
      target: [notes.userId, notes.date],
      set: {
        title: values.title,
        body: values.body,
        mood: values.mood,
        motivation: values.motivation,
        tags: values.tags,
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!row) throw new Error('failed to save note')
  return {
    id: row.id,
    date: row.date,
    title: row.title,
    body: row.body,
    mood: row.mood,
    motivation: row.motivation,
    tags: row.tags,
  }
}

export async function deleteNote(userId: string, date: string): Promise<void> {
  await db.delete(notes).where(and(eq(notes.userId, userId), eq(notes.date, date)))
}
