/**
 * Storage for the Playbook: setups, positions and their leg annotations.
 *
 * Only what the owner states is stored — the anchor that says which holding
 * streak a position is, and the annotations. Which trades belong to it, its
 * status and its result are derived from the trade history on every read by
 * `lib/playbook/streaks.ts`; this module only hands that function its inputs.
 *
 * Every query is scoped by `userId`, child tables included, so an id straight
 * from a request body that belongs to someone else matches nothing. An id
 * stored as a value matches no `where`, and the foreign keys do not know the
 * owner, so those are checked with `ownsSetup` and `ownsTrade` before writing.
 */
import { randomUUID } from 'node:crypto'
import Decimal from 'decimal.js'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import {
  correctedEntryFacts,
  createExitRule,
  ExitPlanRefused,
  listExitRules,
  type ExitRuleInput,
  type ExitRuleRecord,
} from './exit.service'
import { decOrNull, idFor, instrumentId, toInstrumentRow } from './mappers'
import { exitRules, instruments, journalEntries, journalLegs, setups, trades } from './schema'
import { listTrades, setTradeJournal, type TradeRecord } from './trades.service'
import { db } from './index'
import type { AccountType, AssetClass, Currency } from '~/lib/domain/types'
import { sharedNotes, type SharedNote } from '~/lib/playbook/position'
import {
  holdingStreaks,
  isOpen,
  legsOf,
  linkCandidates,
  linkedPlanDate,
  pairTypedLegs,
  resolvePosition,
  streakOfPlan,
  type HoldingStreak,
  type StreakTrade,
} from '~/lib/playbook/streaks'
import type { Criterion, ExtraTarget, JournalKind, LegSide } from '~/lib/playbook/types'
import { extraTargetsProblem, ratingProblem } from '~/lib/playbook/validate'

export type PlaybookResult<T = string> = { ok: true; value: T } | { ok: false; message: string }

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message })

async function ownsSetup(userId: string, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: setups.id })
    .from(setups)
    .where(and(eq(setups.userId, userId), eq(setups.id, id)))
  return row !== undefined
}

/** Soft-deleted rows count: a regrouped fill is still the owner's to refer to. */
async function ownsTrade(userId: string, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.userId, userId), eq(trades.id, id)))
  return row !== undefined
}

// ── Setups ──────────────────────────────────────────────────────────────────

export interface SetupRecord {
  id: string
  name: string
  description: string
  criteria: Criterion[]
  archivedAt: Date | null
}

export interface SetupInput {
  name: string
  description: string
  /** A criterion without an id is new; one with an id keeps its ticks. */
  criteria: { id?: string; text: string }[]
}

const newId = (kind: string) => idFor(kind, randomUUID())

function cleanCriteria(criteria: SetupInput['criteria']): Criterion[] {
  return criteria
    .map((criterion) => ({ id: criterion.id ?? newId('criterion'), text: criterion.text.trim() }))
    .filter((criterion) => criterion.text !== '')
}

export async function listSetups(userId: string, includeArchived = false): Promise<SetupRecord[]> {
  const conditions = [eq(setups.userId, userId)]
  if (!includeArchived) conditions.push(isNull(setups.archivedAt))
  const rows = await db
    .select()
    .from(setups)
    .where(and(...conditions))
    .orderBy(asc(setups.name))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    criteria: row.criteria,
    archivedAt: row.archivedAt,
  }))
}

/**
 * Checked explicitly before writing, as `createExitRule` does, so a clash is a
 * message rather than a raw 23505 from the partial index.
 */
async function nameTaken(userId: string, name: string, exceptId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: setups.id })
    .from(setups)
    .where(and(eq(setups.userId, userId), eq(setups.name, name), isNull(setups.archivedAt)))
  return rows.some((row) => row.id !== exceptId)
}

export async function createSetup(userId: string, input: SetupInput): Promise<PlaybookResult> {
  const name = input.name.trim()
  if (name === '') return fail('A setup needs a name.')
  if (await nameTaken(userId, name)) return fail(`There is already a setup called ${name}.`)
  const id = newId('setup')
  await db.insert(setups).values({
    id,
    userId,
    name,
    description: input.description.trim(),
    criteria: cleanCriteria(input.criteria),
  })
  return { ok: true, value: id }
}

export async function updateSetup(userId: string, id: string, input: SetupInput): Promise<PlaybookResult> {
  const name = input.name.trim()
  if (name === '') return fail('A setup needs a name.')
  if (await nameTaken(userId, name, id)) return fail(`There is already a setup called ${name}.`)
  const [row] = await db
    .update(setups)
    .set({ name, description: input.description.trim(), criteria: cleanCriteria(input.criteria), updatedAt: new Date() })
    .where(and(eq(setups.userId, userId), eq(setups.id, id)))
    .returning({ id: setups.id })
  return row ? { ok: true, value: row.id } : fail('That setup no longer exists.')
}

/** Kept, not deleted: its positions still name it. Archiving frees the name. */
export async function archiveSetup(userId: string, id: string): Promise<void> {
  await db
    .update(setups)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(setups.userId, userId), eq(setups.id, id)))
}

// ── Positions ───────────────────────────────────────────────────────────────

export interface JournalLegRecord {
  id: string
  side: LegSide
  date: string
  firstTradeId: string | null
  executedAt: Date | null
  price: Decimal | null
  quantity: Decimal | null
  fee: Decimal | null
  rating: number | null
  note: string | null
}

export interface JournalEntryRecord {
  id: string
  kind: JournalKind
  setupId: string | null
  instrumentId: string
  symbol: string
  name: string
  assetClass: AssetClass
  currency: Currency
  accountType: AccountType | null
  entryDate: string
  anchorTradeId: string | null
  stopPrice: Decimal | null
  target1Price: Decimal | null
  extraTargets: ExtraTarget[]
  accountEquity: Decimal | null
  riskRatingOverride: number | null
  criteriaMet: string[]
  mistakes: string[]
  lessons: string
  archivedAt: Date | null
  legs: JournalLegRecord[]
}

function toLeg(row: typeof journalLegs.$inferSelect): JournalLegRecord {
  return {
    id: row.id,
    side: row.side,
    date: row.date,
    firstTradeId: row.firstTradeId,
    executedAt: row.executedAt,
    price: decOrNull(row.price),
    quantity: decOrNull(row.quantity),
    fee: decOrNull(row.fee),
    rating: row.rating,
    note: row.note,
  }
}

export async function listJournalEntries(
  userId: string,
  { includeArchived = false, ids }: { includeArchived?: boolean; ids?: string[] } = {},
): Promise<JournalEntryRecord[]> {
  const conditions = [eq(journalEntries.userId, userId)]
  if (!includeArchived) conditions.push(isNull(journalEntries.archivedAt))
  if (ids) {
    if (ids.length === 0) return []
    conditions.push(inArray(journalEntries.id, ids))
  }
  const rows = await db
    .select({ entry: journalEntries, instrument: instruments })
    .from(journalEntries)
    .innerJoin(instruments, eq(journalEntries.instrumentId, instruments.id))
    .where(and(...conditions))
    .orderBy(asc(journalEntries.entryDate))
  if (rows.length === 0) return []

  const legRows = await db
    .select()
    .from(journalLegs)
    .where(
      and(
        eq(journalLegs.userId, userId),
        inArray(
          journalLegs.journalId,
          rows.map((row) => row.entry.id),
        ),
      ),
    )
    .orderBy(asc(journalLegs.date), asc(journalLegs.createdAt))
  const legsBy = new Map<string, JournalLegRecord[]>()
  for (const row of legRows) {
    const list = legsBy.get(row.journalId) ?? []
    list.push(toLeg(row))
    legsBy.set(row.journalId, list)
  }

  return rows.map(({ entry, instrument }) => ({
    id: entry.id,
    kind: entry.kind,
    setupId: entry.setupId,
    instrumentId: entry.instrumentId,
    symbol: instrument.symbol,
    name: instrument.name,
    assetClass: instrument.assetClass,
    currency: instrument.currency,
    accountType: entry.accountType,
    entryDate: entry.entryDate,
    anchorTradeId: entry.anchorTradeId,
    stopPrice: decOrNull(entry.stopPrice),
    target1Price: decOrNull(entry.target1Price),
    extraTargets: entry.extraTargets,
    accountEquity: decOrNull(entry.accountEquity),
    riskRatingOverride: entry.riskRatingOverride,
    criteriaMet: entry.criteriaMet,
    mistakes: entry.mistakes,
    lessons: entry.lessons,
    archivedAt: entry.archivedAt,
    legs: legsBy.get(entry.id) ?? [],
  }))
}

export async function getJournalEntry(userId: string, id: string): Promise<JournalEntryRecord | null> {
  const [entry] = await listJournalEntries(userId, { includeArchived: true, ids: [id] })
  return entry ?? null
}

/** Stored trades as streaks read them: id, stored time and memo alongside each. */
export const toStreakTrades = (records: readonly TradeRecord[]): StreakTrade[] =>
  records.map((record) => ({
    id: record.id,
    trade: record.trade,
    executedAt: record.executedAt,
    memo: record.memo,
  }))

/** Every streak in the user's history, each trade carrying its stored time. */
export async function streaksFor(userId: string): Promise<HoldingStreak[]> {
  return holdingStreaks(toStreakTrades(await listTrades(userId)))
}

/**
 * The anchors of streaks that live real positions resolve to — by anchor or
 * by the entry-date fallback, which the partial unique index cannot see.
 */
export function claimedStreaks(
  entries: readonly JournalEntryRecord[],
  streaks: readonly HoldingStreak[],
  exceptId?: string,
): Set<string> {
  const claimed = new Set<string>()
  for (const entry of entries) {
    if (entry.id === exceptId || entry.kind !== 'REAL' || entry.archivedAt || !entry.accountType) continue
    const resolved = resolvePosition({ ...entry, accountType: entry.accountType }, streaks)
    if (resolved.kind === 'FOUND') claimed.add(resolved.streak.anchorId)
  }
  return claimed
}

/** A live plan opened with a position: same transaction, `journal_id` set. */
export interface LivePlanInput {
  rule: Omit<ExitRuleInput, 'journalId'>
  multiples: { stopAtr: string; target: string }
}

export interface TypedLegInput {
  side: LegSide
  date: string
  executedAt: Date | null
  price: string
  quantity: string
  fee: string
  rating: number | null
  note: string | null
}

export interface JournalEntryInput {
  kind: JournalKind
  setupId: string | null
  symbol: string
  /** Used only to create the instrument when no import has yet. */
  name: string
  assetClass: AssetClass
  accountType: AccountType | null
  entryDate: string
  /** A streak's first opening trade — from a holding or a past trade. */
  anchorTradeId: string | null
  stopPrice: string | null
  target1Price: string | null
  extraTargets: ExtraTarget[]
  accountEquity: string | null
  /** Typed-in fills: a position awaiting import, or a paper one. */
  legs: TypedLegInput[]
}

function typedLegProblem(leg: TypedLegInput): string | null {
  for (const [label, value] of [
    ['price', leg.price],
    ['quantity', leg.quantity],
  ] as const) {
    try {
      if (!new Decimal(value).gt(0)) return `Each leg needs a ${label} above zero.`
    } catch {
      return `Each leg needs a ${label} above zero.`
    }
  }
  return ratingProblem(leg.rating)
}

/**
 * File a position.
 *
 * From a holding or a past trade it is anchored to that streak, which must be
 * one no other live position resolves to. From scratch it is awaiting import
 * and carries typed legs; a paper one carries typed legs and never reaches
 * the engine. Either way the instrument row is ensured, with the id a later
 * import will use, so that import corrects anything typed by hand.
 */
export async function createJournalEntry(
  userId: string,
  given: JournalEntryInput,
  live: LivePlanInput | null = null,
): Promise<PlaybookResult> {
  let input = given
  const problem =
    extraTargetsProblem(input.extraTargets) ??
    input.legs.map(typedLegProblem).find((message) => message !== null) ??
    null
  if (problem) return fail(problem)
  if (input.kind === 'PAPER' && input.accountType !== null) return fail('A paper position has no account.')
  if (input.kind === 'PAPER' && input.anchorTradeId !== null) return fail('A paper position has no trades.')
  if (input.kind === 'REAL' && input.accountType === null) return fail('Choose the account it was traded in.')
  if (input.setupId !== null && !(await ownsSetup(userId, input.setupId))) return fail('That setup no longer exists.')
  if (input.anchorTradeId === null && !input.legs.some((leg) => leg.side === 'ENTRY')) {
    return fail('Enter the buy, or file it from a holding.')
  }

  if (input.kind === 'REAL' && input.anchorTradeId !== null) {
    const streaks = await streaksFor(userId)
    const streak = streaks.find((candidate) => candidate.anchorId === input.anchorTradeId)
    if (streak?.symbol !== input.symbol || streak.accountType !== input.accountType) {
      return fail('Those trades are no longer a position — reload and try again.')
    }
    const claimed = claimedStreaks(await listJournalEntries(userId), streaks)
    if (claimed.has(streak.anchorId)) return fail(`${input.symbol} from ${streak.entryDate} is already in the Playbook.`)
    // The anchor's fallback key is the streak's start, not a date typed for the plan.
    input = { ...input, entryDate: streak.entryDate }
  }

  const retiring = live && (await finishedPlanOnPool(userId, input))

  const id = newId('journal')
  try {
    await db.transaction(async (tx) => {
      await insertEntry(tx, userId, id, input)
      // Together with the new plan, or the old one is either stranded beside it
      // or archived for a position that never got opened.
      if (retiring) {
        await tx
          .update(exitRules)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(exitRules.userId, userId), eq(exitRules.id, retiring)))
      }
      if (live) {
        await createExitRule(userId, { ...live.rule, journalId: id }, live.multiples, tx)
      }
    })
  } catch (error) {
    if (error instanceof ExitPlanRefused) return fail(error.message)
    throw error
  }
  return { ok: true, value: id }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function insertEntry(tx: Tx, userId: string, id: string, input: JournalEntryInput): Promise<void> {
  // Weak insert: an import's upsert overwrites name, class and currency.
  await tx
    .insert(instruments)
    .values(
      toInstrumentRow({
        symbol: input.symbol,
        name: input.name,
        assetClass: input.assetClass,
        currency: input.assetClass === 'US_EQUITY' ? 'USD' : 'JPY',
      }),
    )
    .onConflictDoNothing()
  await tx.insert(journalEntries).values({
    id,
    userId,
    setupId: input.setupId,
    kind: input.kind,
    instrumentId: instrumentId(input.symbol),
    accountType: input.accountType,
    entryDate: input.entryDate,
    anchorTradeId: input.anchorTradeId,
    stopPrice: input.stopPrice,
    target1Price: input.target1Price,
    extraTargets: input.extraTargets,
    accountEquity: input.accountEquity,
  })
  if (input.legs.length > 0) {
    await tx.insert(journalLegs).values(
      input.legs.map((leg) => ({
        id: newId('leg'),
        journalId: id,
        userId,
        side: leg.side,
        date: leg.date,
        executedAt: leg.executedAt,
        price: leg.price,
        quantity: leg.quantity,
        fee: leg.fee,
        rating: leg.rating,
        note: leg.note,
      })),
    )
  }
}

/**
 * Bought, not exported yet — so nothing about this pool can be holding units or
 * already waiting for the same export. Those are "from a holding", and a linked
 * streak could then be claimed by only one of the two.
 */
export async function scratchProblem(
  userId: string,
  input: Pick<JournalEntryInput, 'symbol' | 'accountType'>,
): Promise<string | null> {
  const streaks = await streaksFor(userId)
  const held = streaks.some(
    (streak) => streak.symbol === input.symbol && streak.accountType === input.accountType && isOpen(streak),
  )
  if (held) return `You already hold ${input.symbol} in that account — open it from the holding instead.`
  const entries = await listJournalEntries(userId)
  const waiting = entries.some(
    (entry) =>
      entry.kind === 'REAL' &&
      entry.anchorTradeId === null &&
      entry.symbol === input.symbol &&
      entry.accountType === input.accountType,
  )
  return waiting ? `${input.symbol} already has a position awaiting import in that account.` : null
}

/**
 * The pool's live plan, when the position it describes is over.
 *
 * Decided here rather than on a read — `toArchive` only ever lists such plans,
 * because archiving during a load would put a write on a read path. A plan still
 * describing an open position stays, and `createExitRule` refuses the new one.
 */
async function finishedPlanOnPool(userId: string, input: JournalEntryInput): Promise<string | null> {
  const plan = (await listExitRules(userId)).find(
    (rule) => rule.symbol === input.symbol && rule.accountType === input.accountType,
  )
  if (!plan) return null
  const streaks = await streaksFor(userId)
  const streak = await streakBehindPlan(userId, plan, streaks)
  if (streak === 'WAITING') return null
  return streak === null || !isOpen(streak) ? plan.id : null
}

/** A plan's streak: its position's if it has one, otherwise by its dates. */
async function streakBehindPlan(
  userId: string,
  plan: ExitRuleRecord,
  streaks: readonly HoldingStreak[],
): Promise<HoldingStreak | null | 'WAITING'> {
  if (!plan.journalId) return streakOfPlan(plan, streaks)
  const entry = await getJournalEntry(userId, plan.journalId)
  if (!entry?.accountType) return streakOfPlan(plan, streaks)
  const resolved = resolvePosition({ ...entry, accountType: entry.accountType }, streaks)
  if (resolved.kind === 'UNLINKED') return 'WAITING'
  return resolved.kind === 'FOUND' ? resolved.streak : null
}

export interface JournalEntryPatch {
  setupId?: string | null
  stopPrice?: string | null
  target1Price?: string | null
  extraTargets?: ExtraTarget[]
  accountEquity?: string | null
  riskRatingOverride?: number | null
  criteriaMet?: string[]
  mistakes?: string[]
  lessons?: string
}

/** The owner's review and static plan. Symbol, account and anchor are not editable here. */
export async function updateJournalEntry(userId: string, id: string, patch: JournalEntryPatch): Promise<PlaybookResult> {
  const problem =
    (patch.extraTargets ? extraTargetsProblem(patch.extraTargets) : null) ??
    (patch.riskRatingOverride !== undefined ? ratingProblem(patch.riskRatingOverride) : null)
  if (problem) return fail(problem)
  if (patch.setupId && !(await ownsSetup(userId, patch.setupId))) return fail('That setup no longer exists.')
  // Built explicitly: spreading the patch would pass any extra field through.
  const [row] = await db
    .update(journalEntries)
    .set({
      ...(patch.setupId !== undefined && { setupId: patch.setupId }),
      ...(patch.stopPrice !== undefined && { stopPrice: patch.stopPrice }),
      ...(patch.target1Price !== undefined && { target1Price: patch.target1Price }),
      ...(patch.extraTargets !== undefined && { extraTargets: patch.extraTargets }),
      ...(patch.accountEquity !== undefined && { accountEquity: patch.accountEquity }),
      ...(patch.riskRatingOverride !== undefined && { riskRatingOverride: patch.riskRatingOverride }),
      ...(patch.criteriaMet !== undefined && { criteriaMet: patch.criteriaMet }),
      ...(patch.mistakes !== undefined && { mistakes: patch.mistakes }),
      ...(patch.lessons !== undefined && { lessons: patch.lessons }),
      updatedAt: new Date(),
    })
    .where(and(eq(journalEntries.userId, userId), eq(journalEntries.id, id)))
    .returning({ id: journalEntries.id })
  return row ? { ok: true, value: row.id } : fail('That position no longer exists.')
}

/** Archives the position and its live exit plan together. The trades stay in Trades. */
export async function archiveJournalEntry(userId: string, id: string): Promise<void> {
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(journalEntries)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(eq(journalEntries.userId, userId), eq(journalEntries.id, id)))
    await tx
      .update(exitRules)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(eq(exitRules.userId, userId), eq(exitRules.journalId, id), isNull(exitRules.archivedAt)))
  })
}

/**
 * Removes the position and its annotations. A plan it owned outlives it, unlinked
 * and archived: left live it would go on pushing notifications about a position
 * that no longer exists. The trades stay, and their memos show again.
 */
export async function deleteJournalEntry(userId: string, id: string): Promise<void> {
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(exitRules)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(eq(exitRules.userId, userId), eq(exitRules.journalId, id), isNull(exitRules.archivedAt)))
    await tx.delete(journalEntries).where(and(eq(journalEntries.userId, userId), eq(journalEntries.id, id)))
  })
}

/** A trade's shared note, for each trade in a live real position. Skips the reads when there are none. */
export async function sharedNotesFor(
  userId: string,
  records: readonly TradeRecord[],
): Promise<Map<string, SharedNote>> {
  const entries = await listJournalEntries(userId)
  if (!entries.some((entry) => entry.kind === 'REAL')) return new Map()
  return sharedNotes(entries, holdingStreaks(toStreakTrades(records)))
}

/**
 * Write a trade's note wherever it now lives: its leg's, when the trade belongs
 * to a position, so the Calendar, the Trades screen and the position page all
 * edit one note. Never marks a trade edited — a note is not a correction.
 *
 * An emptied leg note is stored as `''`, so its fills' memos do not reappear.
 */
export async function saveTradeNote(userId: string, tradeId: string, note: string | null): Promise<void> {
  const shared = (await sharedNotesFor(userId, await listTrades(userId))).get(tradeId)
  if (!shared) {
    await setTradeJournal(userId, tradeId, { memo: note })
    return
  }
  // The Calendar sends the note it shows even when only the motivation changed,
  // and writing it back would copy a fill's memos into the leg.
  if ((note ?? '') === shared.note.trim()) return
  const result = await setLegAnnotation(userId, shared.journalId, {
    legId: shared.annotationId ?? undefined,
    side: shared.side,
    date: shared.date,
    firstTradeId: shared.firstTradeId,
    note: note ?? '',
  })
  if (!result.ok) throw new Error(result.message)
}

// ── Legs ────────────────────────────────────────────────────────────────────

export interface AnnotationInput {
  side: LegSide
  date: string
  /** The derived leg's first fill; null for a typed leg. */
  firstTradeId: string | null
  /** Left alone when absent, so saving a note cannot clear a rating or the reverse. */
  rating?: number | null
  note?: string | null
}

/**
 * Rate or note a leg. A linked leg's annotation is found by its first fill and
 * created on first use; `legId` addresses a typed or unattached one directly.
 */
export async function setLegAnnotation(
  userId: string,
  journalId: string,
  input: AnnotationInput & { legId?: string },
): Promise<PlaybookResult> {
  const problem = ratingProblem(input.rating ?? null)
  if (problem) return fail(problem)
  const [entry] = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(and(eq(journalEntries.userId, userId), eq(journalEntries.id, journalId)))
  if (!entry) return fail('That position no longer exists.')

  const target = input.legId
    ? eq(journalLegs.id, input.legId)
    : input.firstTradeId
      ? eq(journalLegs.firstTradeId, input.firstTradeId)
      : null
  if (target) {
    const [row] = await db
      .update(journalLegs)
      .set({
        ...(input.rating !== undefined && { rating: input.rating }),
        ...(input.note !== undefined && { note: input.note }),
        updatedAt: new Date(),
      })
      .where(and(eq(journalLegs.userId, userId), eq(journalLegs.journalId, journalId), target))
      .returning({ id: journalLegs.id })
    if (row) return { ok: true, value: row.id }
    if (input.legId) return fail('That leg no longer exists.')
  }
  if (input.firstTradeId !== null && !(await ownsTrade(userId, input.firstTradeId))) {
    return fail('Those trades are no longer a position — reload and try again.')
  }
  const id = newId('leg')
  await db.insert(journalLegs).values({
    id,
    journalId,
    userId,
    side: input.side,
    date: input.date,
    firstTradeId: input.firstTradeId,
    rating: input.rating ?? null,
    note: input.note ?? null,
  })
  return { ok: true, value: id }
}

/**
 * A linked leg's time, written through to its fills that have none yet. A time
 * already entered on import or on the Trades screen wins, as it does on linking.
 */
export async function setLegTime(
  userId: string,
  journalId: string,
  firstTradeId: string,
  executedAt: Date | null,
): Promise<PlaybookResult> {
  const entry = await getJournalEntry(userId, journalId)
  if (!entry?.accountType) return fail('That position no longer exists.')
  const resolved = resolvePosition({ ...entry, accountType: entry.accountType }, await streaksFor(userId))
  if (resolved.kind !== 'FOUND') return fail('That position has no trades to set a time on.')
  const leg = legsOf(resolved.streak).find((candidate) => candidate.firstTradeId === firstTradeId)
  if (!leg) return fail('That leg no longer exists — reload and try again.')
  await db
    .update(trades)
    .set({ executedAt, updatedAt: new Date() })
    .where(
      and(
        eq(trades.userId, userId),
        inArray(
          trades.id,
          leg.fills.map((fill) => fill.id),
        ),
        isNull(trades.executedAt),
      ),
    )
  return { ok: true, value: journalId }
}

/**
 * Replace a position's typed legs — awaiting import and paper only; a linked
 * position's figures come from its trades. Legs named by id keep their rating and
 * note, and the position's entry date follows the earliest typed entry — its live
 * plan's too, since the plan replays bars from that date and has no other way to
 * have it corrected.
 */
export async function replaceTypedLegs(
  userId: string,
  journalId: string,
  legs: readonly (Omit<TypedLegInput, 'rating' | 'note'> & { id?: string })[],
): Promise<PlaybookResult> {
  const entry = await getJournalEntry(userId, journalId)
  if (!entry) return fail('That position no longer exists.')
  if (entry.kind === 'REAL' && entry.anchorTradeId !== null) return fail('These legs come from the trades.')
  const problem = legs.map((leg) => typedLegProblem({ ...leg, rating: null, note: null })).find((message) => message)
  if (problem) return fail(problem)
  const entries = legs.filter((leg) => leg.side === 'ENTRY')
  if (entries.length === 0) return fail('A position needs at least one buy.')
  const entryDate = entries.map((leg) => leg.date).sort()[0]!

  const kept = new Set(legs.flatMap((leg) => (leg.id ? [leg.id] : [])))
  const stored = new Set(entry.legs.map((leg) => leg.id))
  const plan = (await listExitRules(userId)).find((rule) => rule.journalId === journalId)
  await db.transaction(async (tx) => {
    for (const leg of entry.legs) {
      if (kept.has(leg.id)) continue
      await tx.delete(journalLegs).where(and(eq(journalLegs.userId, userId), eq(journalLegs.id, leg.id)))
    }
    for (const leg of legs) {
      const values = {
        side: leg.side,
        date: leg.date,
        executedAt: leg.executedAt,
        price: leg.price,
        quantity: leg.quantity,
        fee: leg.fee,
      }
      if (leg.id && stored.has(leg.id)) {
        await tx
          .update(journalLegs)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(journalLegs.userId, userId), eq(journalLegs.id, leg.id)))
      } else {
        await tx.insert(journalLegs).values({ ...values, id: newId('leg'), journalId, userId })
      }
    }
    await tx
      .update(journalEntries)
      .set({ entryDate, updatedAt: new Date() })
      .where(and(eq(journalEntries.userId, userId), eq(journalEntries.id, journalId)))
    if (plan && plan.entryDate !== entryDate) {
      await tx
        .update(exitRules)
        .set({ ...(await correctedEntryFacts(plan.instrumentId, entryDate, tx)), updatedAt: new Date() })
        .where(and(eq(exitRules.userId, userId), eq(exitRules.id, plan.id)))
    }
  })
  return { ok: true, value: journalId }
}

/** Points an unattached annotation at a leg again, by that leg's first fill. */
export async function reattachAnnotation(
  userId: string,
  legId: string,
  leg: { firstTradeId: string; side: LegSide; date: string },
): Promise<PlaybookResult> {
  if (!(await ownsTrade(userId, leg.firstTradeId))) {
    return fail('Those trades are no longer a position — reload and try again.')
  }
  const [row] = await db
    .update(journalLegs)
    .set({ firstTradeId: leg.firstTradeId, side: leg.side, date: leg.date, updatedAt: new Date() })
    .where(and(eq(journalLegs.userId, userId), eq(journalLegs.id, legId)))
    .returning({ id: journalLegs.id })
  return row ? { ok: true, value: row.id } : fail('That leg no longer exists.')
}

// ── Linking ─────────────────────────────────────────────────────────────────

/**
 * Streaks a position may be linked to: one awaiting import, or one that has lost
 * its trades and offers a relink. Empty for any other position.
 */
export async function candidatesFor(userId: string, journalId: string): Promise<HoldingStreak[]> {
  const entry = await getJournalEntry(userId, journalId)
  if (entry?.kind !== 'REAL' || !entry.accountType) return []
  const streaks = await streaksFor(userId)
  const resolved = resolvePosition({ ...entry, accountType: entry.accountType }, streaks)
  if (resolved.kind === 'FOUND') return []
  const claimed = claimedStreaks(await listJournalEntries(userId), streaks, journalId)
  return linkCandidates({ ...entry, accountType: entry.accountType }, streaks, claimed)
}

/**
 * Link a position awaiting import to the streak the owner picked.
 *
 * The import never does this; it only reports that matching trades exist. The
 * typed legs become annotations of the derived legs — by side, then in order
 * — keeping their ratings and notes, and each typed time is written to its
 * fills that have none yet. Typed legs with no counterpart stay, unattached.
 */
export async function linkJournalEntry(
  userId: string,
  journalId: string,
  anchorTradeId: string,
  { correctPlan = false }: { correctPlan?: boolean } = {},
): Promise<PlaybookResult> {
  const entry = await getJournalEntry(userId, journalId)
  if (!entry) return fail('That position no longer exists.')
  const streak = (await candidatesFor(userId, journalId)).find((candidate) => candidate.anchorId === anchorTradeId)
  if (!streak) return fail('Those trades are not a match for this position — reload and try again.')

  const plan = correctPlan ? (await listExitRules(userId)).find((rule) => rule.journalId === journalId) : undefined
  if (plan?.supportLevel.gte(streak.entryPrice)) {
    return fail('The plan’s support sits above the imported entry price — edit the plan first.')
  }
  if (plan?.target1Override?.lte(streak.entryPrice)) {
    return fail('The plan’s Target 1 sits at or below the imported entry price — edit the plan first.')
  }

  const typed = entry.legs.filter((leg) => leg.firstTradeId === null)
  const { pairs, times } = pairTypedLegs(
    typed.map((leg) => ({ id: leg.id, side: leg.side, quantity: leg.quantity, executedAt: leg.executedAt })),
    legsOf(streak),
  )

  await db.transaction(async (tx) => {
    await tx
      .update(journalEntries)
      .set({ anchorTradeId, entryDate: streak.entryDate, updatedAt: new Date() })
      .where(and(eq(journalEntries.userId, userId), eq(journalEntries.id, journalId)))
    for (const { typedId, leg } of pairs) {
      // Its figures now come from the trades, so the typed copies go.
      await tx
        .update(journalLegs)
        .set({
          firstTradeId: leg.firstTradeId,
          date: leg.date,
          executedAt: null,
          price: null,
          quantity: null,
          fee: null,
          updatedAt: new Date(),
        })
        .where(and(eq(journalLegs.userId, userId), eq(journalLegs.id, typedId)))
    }
    for (const [tradeId, executedAt] of times) {
      await tx
        .update(trades)
        .set({ executedAt, updatedAt: new Date() })
        .where(and(eq(trades.userId, userId), eq(trades.id, tradeId), isNull(trades.executedAt)))
    }
    if (plan) {
      // The typo-correction path: fixing the record is not the market moving it.
      const entryDate = linkedPlanDate(plan, streak.entryDate)
      await tx
        .update(exitRules)
        .set({
          entryPrice: streak.entryPrice.toFixed(),
          totalShares: streak.sharesBought.toFixed(),
          ...(entryDate !== plan.entryDate && (await correctedEntryFacts(plan.instrumentId, entryDate, tx))),
          updatedAt: new Date(),
        })
        .where(and(eq(exitRules.userId, userId), eq(exitRules.id, plan.id)))
    }
  })
  return { ok: true, value: journalId }
}

/** How many positions awaiting import have trades to link — what an import reports. */
export async function linkablePositions(userId: string): Promise<number> {
  const entries = await listJournalEntries(userId)
  const waiting = entries.filter((entry) => entry.kind === 'REAL' && entry.anchorTradeId === null)
  if (waiting.length === 0) return 0
  const streaks = await streaksFor(userId)
  const claimed = claimedStreaks(entries, streaks)
  return waiting.filter(
    (entry) => entry.accountType && linkCandidates({ ...entry, accountType: entry.accountType }, streaks, claimed).length > 0,
  ).length
}

// ── Filing existing plans ───────────────────────────────────────────────────

/** One plan that predates the Playbook, and whether it has a streak to file under. */
export interface UnfiledPlan {
  plan: ExitRuleRecord
  /** Null when no unclaimed streak matches: it can only be archived. */
  streak: HoldingStreak | null
}

export function unfiledPlans(
  plans: readonly ExitRuleRecord[],
  streaks: readonly HoldingStreak[],
  claimed: ReadonlySet<string>,
): UnfiledPlan[] {
  return plans
    .filter((plan) => plan.journalId === null && plan.archivedAt === null)
    .map((plan) => {
      const streak = streakOfPlan(plan, streaks)
      return { plan, streak: streak && !claimed.has(streak.anchorId) ? streak : null }
    })
}

/**
 * Give every live plan that predates the Playbook a position anchored to its
 * streak, so nothing is managed from two places. No setup yet, and no account
 * size: both are the owner's to add. Each is its own transaction, so one bad plan
 * cannot leave the rest unfiled.
 */
export async function fileExistingPlans(userId: string): Promise<{ filed: number; skipped: number }> {
  const [plans, entries, streaks] = await Promise.all([
    listExitRules(userId),
    listJournalEntries(userId),
    streaksFor(userId),
  ])
  const pending = unfiledPlans(plans, streaks, claimedStreaks(entries, streaks))
  let filed = 0
  for (const { plan, streak } of pending) {
    if (!streak) continue
    const id = newId('journal')
    await db.transaction(async (tx) => {
      await tx.insert(journalEntries).values({
        id,
        userId,
        kind: 'REAL',
        instrumentId: plan.instrumentId,
        accountType: plan.accountType,
        entryDate: streak.entryDate,
        anchorTradeId: streak.anchorId,
      })
      await tx
        .update(exitRules)
        .set({ journalId: id, updatedAt: new Date() })
        .where(and(eq(exitRules.userId, userId), eq(exitRules.id, plan.id)))
    })
    filed += 1
  }
  return { filed, skipped: pending.length - filed }
}
