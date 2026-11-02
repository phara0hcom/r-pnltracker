/**
 * Shared shapes for the Playbook — the trade journal.
 *
 * The enums here are kept in step with their Postgres enums in `db/schema.ts`
 * by hand, as `exit_action_kind` is.
 */

/** Real positions follow the trade history; paper ones never reach the engine. */
export type JournalKind = 'REAL' | 'PAPER'
export const JOURNAL_KINDS: readonly JournalKind[] = ['REAL', 'PAPER']

/** One decision: opening or closing units. */
export type LegSide = 'ENTRY' | 'EXIT'
export const LEG_SIDES: readonly LegSide[] = ['ENTRY', 'EXIT']

export type ImagePhase = 'PLAN' | 'ENTRY' | 'DURING' | 'EXIT'
export const IMAGE_PHASES: readonly ImagePhase[] = ['PLAN', 'ENTRY', 'DURING', 'EXIT']

/**
 * Derived on every read, never stored.
 *
 * `AWAITING_IMPORT` is a real position opened before its export existed — not
 * "planned", because the trade has already happened. `MISSING` is a linked
 * position whose streak can no longer be found; it offers a relink rather than
 * guessing.
 */
export type PositionStatus = 'AWAITING_IMPORT' | 'OPEN' | 'CLOSED' | 'MISSING'

/** A setup criterion. The id survives a rename, so ticks recorded against it do too. */
export interface Criterion {
  id: string
  text: string
}

/** A display-only target beyond Target 1. Decimals as strings, as stored. */
export interface ExtraTarget {
  price: string
  /** Of the position, 0–1. A position's fractions sum to at most 1. */
  fraction: string
}
