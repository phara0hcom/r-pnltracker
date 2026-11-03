/**
 * Execution times: entered in JST, stored as an instant.
 *
 * No Rakuten export carries a time, so the owner types one in on the import
 * screen. It is an instant rather than a time of day because a US fill falls
 * after midnight JST: before settlement Rakuten dates it by the US session,
 * after it by the JST one (see the restatement note in `CLAUDE.md`). So its JST
 * date can be the stored 約定日 or the day after — or, once a restatement moves
 * 約定日 past a time entered before midnight, the day before — and a bare "02:30"
 * would be ambiguous. The day offset settles which.
 *
 * Funds (投資信託) get no time: they fill at the day's 基準価額, not at a
 * moment. Exchange-listed ETFs bought as stock are equities and do.
 *
 * Pure, so the preview, the commit and the calendar share one reading.
 */
import type { AssetClass, Market } from '../domain/types'
import { marketOf } from '../domain/types'

export type DayOffset = -1 | 0 | 1

/** What the time input holds: `HH:MM` in JST, and its day relative to 約定日. */
export interface TimeInput {
  time: string
  dayOffset: DayOffset
}

export const EMPTY_TIME: TimeInput = { time: '', dayOffset: 0 }

/** Null for funds — the one class that is never asked for a time. */
export const timedMarket = (assetClass: AssetClass): Market | null =>
  assetClass === 'FUND' ? null : marketOf(assetClass)

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/** The instant a JST time on (or a day either side of) `tradeDate` names, or null when it is blank or malformed. */
export function resolveExecutedAt(tradeDate: string, input: TimeInput): Date | null {
  // A date still being typed is as blank as the time: an Invalid Date would throw
  // from the first thing that formats it, mid-render.
  if (!TIME.test(input.time) || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return null
  const date = addDays(tradeDate, input.dayOffset)
  // JST has no daylight saving, so the offset is fixed.
  return new Date(`${date}T${input.time}:00+09:00`)
}

interface LocalParts {
  date: string
  weekday: string
  hour: number
  minute: number
}

function localParts(at: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const md = (date: string) => `${String(Number(date.slice(5, 7)))}/${String(Number(date.slice(8, 10)))}`

/** The inverse of `resolveExecutedAt`, for showing a stored instant in the input. */
export function toTimeInput(tradeDate: string, at: Date | null): TimeInput {
  if (!at) return EMPTY_TIME
  const jst = localParts(at, 'Asia/Tokyo')
  const offsets: DayOffset[] = [-1, 1]
  return {
    time: `${pad(jst.hour)}:${pad(jst.minute)}`,
    // A trade re-dated by hand may sit further away; the time is kept and the
    // owner sees it against the new date.
    dayOffset: offsets.find((offset) => jst.date === addDays(tradeDate, offset)) ?? 0,
  }
}

/**
 * What an input means for the stored time: an ISO instant to write, null to
 * clear it, or undefined to leave it alone.
 *
 * An input the owner did not touch never writes, even if it would resolve to
 * something else. An instant further than a day from 約定日 cannot be shown
 * exactly, and comparing the resolved instant with the stored one would write
 * that difference as if it had been typed — a restatement once moved times a
 * day that way. Moving `date` by hand counts as an edit: the time goes with it.
 */
export function timeEdit(
  stored: { tradeDate: string; executedAt: string | null },
  date: string,
  input: TimeInput,
): string | null | undefined {
  const shown = toTimeInput(stored.tradeDate, stored.executedAt ? new Date(stored.executedAt) : null)
  if (date === stored.tradeDate && input.time === shown.time && input.dayOffset === shown.dayOffset) {
    return undefined
  }
  const at = resolveExecutedAt(date, input)?.toISOString() ?? null
  return at === stored.executedAt ? undefined : at
}

/** `10/21 00:30 JST`. */
export function formatJst(at: Date): string {
  const jst = localParts(at, 'Asia/Tokyo')
  return `${md(jst.date)} ${pad(jst.hour)}:${pad(jst.minute)} JST`
}

/** `10/20 11:30 ET` — EDT or EST as the date has it. */
export function formatEt(at: Date): string {
  const et = localParts(at, 'America/New_York')
  return `${md(et.date)} ${pad(et.hour)}:${pad(et.minute)} ET`
}

/** `HH:MM` in JST, for a list that already shows the date. */
export function formatJstTime(at: Date): string {
  const jst = localParts(at, 'Asia/Tokyo')
  return `${pad(jst.hour)}:${pad(jst.minute)}`
}

/**
 * Minutes after local midnight each market can fill in, extended hours included.
 *
 * Japan: Rakuten's PTS (08:20–16:00 and 17:00–23:59), which contains the TSE
 * session. US: 04:00–20:00 New York time, pre-market to after-hours.
 */
const SESSIONS: Record<Market, { zone: string; windows: [number, number][]; label: string }> = {
  JP: {
    zone: 'Asia/Tokyo',
    windows: [
      [8 * 60 + 20, 16 * 60],
      [17 * 60, 24 * 60],
    ],
    label: 'TSE and PTS hours (08:20–16:00, 17:00–23:59 JST)',
  },
  US: {
    zone: 'America/New_York',
    windows: [[4 * 60, 20 * 60]],
    label: 'US hours, extended included (04:00–20:00 ET)',
  },
}

/**
 * Why `at` looks wrong for `market`, or null when it falls in a session.
 *
 * A warning, never a refusal: holidays are not checked, and the owner knows
 * when they traded better than this does. It exists to catch 03:00 typed for
 * 15:00, or a US fill left on the wrong side of midnight.
 */
export function sessionWarning(at: Date, market: Market): string | null {
  const session = SESSIONS[market]
  const local = localParts(at, session.zone)
  if (local.weekday === 'Sat' || local.weekday === 'Sun') {
    return `That is a ${local.weekday === 'Sat' ? 'Saturday' : 'Sunday'} on the exchange — check the time and its day.`
  }
  const minutes = local.hour * 60 + local.minute
  if (session.windows.some(([from, to]) => minutes >= from && minutes < to)) return null
  return `Outside ${session.label}.`
}

/**
 * A day's list re-ordered by time, pool by pool, or null when no pool can be.
 *
 * A pool is re-ordered only when every one of its trades has a time; its
 * trades are then put in time order within the places it already occupies, so
 * a pool still missing a time keeps the engine's order untouched. This only
 * suggests — the caller still has the owner confirm it, because a confirmed
 * order moves the day's figures away from Rakuten's buys-first count.
 */
export function orderByTime<T>(
  items: readonly T[],
  poolOf: (item: T) => string,
  timeOf: (item: T) => Date | null,
): T[] | null {
  const pools = new Map<string, T[]>()
  for (const item of items) {
    const list = pools.get(poolOf(item)) ?? []
    list.push(item)
    pools.set(poolOf(item), list)
  }
  const sorted = new Map<string, T[]>()
  for (const [pool, list] of pools) {
    if (list.length < 2 || list.some((item) => timeOf(item) === null)) continue
    // Stable, so two fills at the same minute keep the order they had.
    sorted.set(
      pool,
      [...list].sort((left, right) => timeOf(left)!.getTime() - timeOf(right)!.getTime()),
    )
  }
  if (sorted.size === 0) return null
  const next = new Map([...sorted].map(([pool, list]) => [pool, list[Symbol.iterator]()]))
  return items.map((item) => next.get(poolOf(item))?.next().value ?? item)
}

/**
 * True when a list already in its stored order puts a later time before an
 * earlier one within a pool — the calendar flags such a day.
 *
 * Trades without a time are skipped rather than counted against the order.
 */
export function orderContradictsTimes<T>(
  items: readonly T[],
  poolOf: (item: T) => string,
  timeOf: (item: T) => Date | null,
): boolean {
  const latest = new Map<string, number>()
  for (const item of items) {
    const at = timeOf(item)
    if (!at) continue
    const pool = poolOf(item)
    const before = latest.get(pool)
    if (before !== undefined && at.getTime() < before) return true
    latest.set(pool, at.getTime())
  }
  return false
}

interface Fill {
  symbol: string
  accountType: string
  side: string
  tradeDate: string
}

const groupOf = (fill: Fill) => `${fill.symbol}\0${fill.accountType}\0${fill.side}\0${fill.tradeDate}`

/**
 * Times for the rows a settled export regroups a day into.
 *
 * Settlement can replace intraday fills (1,000 + 800 + 2,600) with differently
 * sized ones (1,800 + 2,600), so no replacement is the same execution as any
 * fill it replaces. A time carries over only when every fill it replaces in
 * that pool, day and side had the same one — otherwise there is no telling
 * which replacement happened when, and it is left for the owner to enter.
 */
export function carriedTimes(
  superseded: readonly (Fill & { executedAt: Date | null })[],
  replacements: readonly (Fill & { id: string })[],
): Map<string, Date> {
  const shared = new Map<string, Date | null>()
  for (const fill of superseded) {
    const key = groupOf(fill)
    if (!shared.has(key)) {
      shared.set(key, fill.executedAt)
    } else {
      const seen = shared.get(key)
      if (seen?.getTime() !== fill.executedAt?.getTime() || !seen) shared.set(key, null)
    }
  }
  const out = new Map<string, Date>()
  for (const row of replacements) {
    const at = shared.get(groupOf(row))
    if (at) out.set(row.id, at)
  }
  return out
}
