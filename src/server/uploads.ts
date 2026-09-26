/**
 * Import server functions.
 *
 * Two phases: preview reports what a file would change without writing, commit
 * applies it. Both run the same `planImport`, so the preview can never disagree
 * with the result.
 */
import { createServerFn } from '@tanstack/react-start'
import { authed } from './middleware'
import { commitImport, previewImport } from '~/db/import.service'
import { idFor } from '~/db/mappers'
import { listTrades, setDayOrder } from '~/db/trades.service'
import type { NormalizedTrade } from '~/lib/domain/types'
import { daysToOrder, type OrderCandidate } from '~/lib/import/dayOrder'
import { figuresOf, orderFilesForImport, type StoredTrade } from '~/lib/import/plan'

export interface UploadPayload {
  filename: string
  /** Base64 — the CSVs are Shift-JIS, so raw bytes must survive the trip intact. */
  base64: string
}

/**
 * Base64 → bytes.
 *
 * Declared inside the server-only region rather than at module scope: this file
 * is split to produce a client stub, and a module-level reference to `Buffer`
 * — which does not exist in the browser — breaks that transform. The symptom is
 * obscure: the split module fails to load, so its server-function IDs never
 * register and every call returns "Invalid server function ID" as a 500.
 */
function decode(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, 'base64'))
}

/**
 * Ceiling on a single decoded file, and on one request's worth of them.
 *
 * The upload screen already refuses anything larger, but that check runs in the
 * browser and is therefore a convenience, not a limit — these handlers decode
 * whatever arrives straight into memory. A real Rakuten export is a few hundred
 * KB; anything near this is a mistake, and should come back as a message rather
 * than as an out-of-memory crash.
 */
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_FILES = 40

/** Decode an upload payload, refusing anything implausible for a CSV export. */
function decodeChecked(files: UploadPayload[]): { filename: string; bytes: Uint8Array }[] {
  if (files.length > MAX_FILES) {
    throw new Error(`Too many files at once (${String(files.length)}; limit is ${String(MAX_FILES)}).`)
  }
  return files.map((file) => {
    const bytes = decode(file.base64)
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(
        `${file.filename} is ${String(Math.round(bytes.byteLength / 1024))} KB, over the ${String(MAX_FILE_BYTES / 1024 / 1024)} MB limit — that is not a Rakuten export.`,
      )
    }
    return { filename: file.filename, bytes }
  })
}

export interface PreviewSummary {
  filename: string
  format: string
  summary: string
  newTrades: number
  newDividends: number
  /**
   * Stored rows Rakuten restated — re-dated, settled, re-rated, or regrouped
   * at settlement — updated or replaced, not added.
   */
  restated: number
  duplicates: number
  snapshots: number
  cash: number
  errors: { line: number; message: string }[]
}

/** One trade in a day the preview offers for ordering. */
export interface PreviewOrderTrade {
  id: string
  symbol: string
  accountType: string
  side: 'BUY' | 'SELL' | 'REINVEST' | 'REDEEM'
  quantity: string
  /** Formatted with its currency; funds per 10,000 口, as Rakuten quotes them. */
  price: string
  /** Added or re-dated by this import, rather than already stored. */
  isNew: boolean
}

export interface PreviewResult {
  files: PreviewSummary[]
  /**
   * Days where the import leaves a pool both bought and sold, in the order the
   * engine would take them. Rakuten exports carry no execution time, so the
   * user is shown them to put right before anything is written.
   */
  days: { date: string; trades: PreviewOrderTrade[] }[]
}

export const previewFiles = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: { files: UploadPayload[] }) => data)
  .handler(async ({ data, context }): Promise<PreviewResult> => {
    /*
     * Logged so a failed upload leaves a trace in the dev server output rather
     * than only in the browser.
     *
     * The filenames stay. They are how you tell which of forty files failed, and
     * they are Rakuten's export names rather than anything about the account.
     * What made them a question was Sentry's console integration, which would
     * have turned this line into a breadcrumb on the next unrelated event — that
     * is switched off in `instrument.server.ts`, which fixes the whole class
     * rather than this one line. The base64 length is gone: it described the
     * upload's size and answered nothing.
     */
    console.warn(
      `[import] preview ${String(data.files.length)} file(s): ` +
        data.files.map((file) => file.filename).join(', '),
    )
    const out: PreviewSummary[] = []
    // Keyed by row id: overlapping exports in one upload carry the same fill,
    // which the commit will insert once.
    const incoming = new Map<string, OrderCandidate>()
    // Previewed in the order they will actually be committed, so the summary
    // describes the run the user is about to approve.
    // What earlier files will have written by the time the commit reaches the
    // next one, keyed by row id.
    const pending = new Map<string, StoredTrade>()
    // Stored rows a settled export regroups away, which the commit deletes.
    const removed = new Set<string>()
    const asStored = (id: string, trade: NormalizedTrade): StoredTrade => ({
      id,
      sourceRowHash: trade.sourceRowHash,
      symbol: trade.symbol,
      accountType: trade.accountType,
      side: trade.side,
      quantity: trade.quantity.toFixed(),
      unitPrice: trade.unitPrice.toFixed(),
      tradeDate: trade.tradeDate,
      settleDate: trade.settleDate,
      isEdited: false,
      origin: 'IMPORT',
      isSettled: trade.isSettled,
      isDeleted: false,
      figures: figuresOf(trade),
    })
    for (const file of orderFilesForImport(decodeChecked(data.files))) {
      const preview = await previewImport(
        context.userId,
        file.filename,
        file.bytes,
        [...pending.values()],
      )
      for (const trade of preview.plan.newTrades) {
        // The id the commit will insert it under — see `toTradeRow`.
        const id = idFor('trade', context.userId, trade.sourceRowHash)
        incoming.set(id, { id, trade, incoming: true })
        pending.set(id, asStored(id, trade))
      }
      for (const restated of preview.plan.restatedTrades) {
        // A restatement keeps the row id, including one an earlier file adds.
        incoming.set(restated.id, { id: restated.id, trade: restated.trade, incoming: true })
        pending.set(restated.id, asStored(restated.id, restated.trade))
      }
      for (const settled of preview.plan.settledTrades) {
        pending.set(settled.id, asStored(settled.id, settled.trade))
      }
      for (const superseded of preview.plan.supersededTrades) {
        pending.set(superseded.id, { ...superseded, isDeleted: true })
        // Out of the day being offered for ordering, as the commit removes it.
        incoming.delete(superseded.id)
        removed.add(superseded.id)
      }
      out.push({
        filename: preview.filename,
        format: preview.format,
        summary: preview.summary,
        newTrades: preview.plan.newTrades.length,
        newDividends: preview.plan.newDividends.length,
        restated:
          preview.plan.restatedTrades.length +
          preview.plan.settledTrades.length +
          preview.plan.supersededTrades.length,
        duplicates: preview.plan.duplicateTrades + preview.plan.duplicateDividends,
        snapshots: preview.snapshotCount,
        cash: preview.cashCount,
        errors: preview.plan.errors.map((error) => ({ line: error.line, message: error.message })),
      })
    }

    const stored = (await listTrades(context.userId))
      .filter((record) => !removed.has(record.id))
      .map((record): OrderCandidate => ({ id: record.id, trade: record.trade, incoming: false }))
    const days = daysToOrder(stored, [...incoming.values()]).map((day) => ({
      date: day.date,
      trades: day.trades.map(({ id, trade, incoming: isNew }) => ({
        id,
        symbol: trade.symbol,
        accountType: trade.accountType,
        side: trade.side,
        quantity: trade.quantity.toFixed(),
        price: `${trade.currency === 'USD' ? '$' : '¥'}${(trade.assetClass === 'FUND'
          ? trade.unitPrice.mul(10_000)
          : trade.unitPrice
        ).toFixed()}`,
        isNew,
      })),
    }))
    return { files: out, days }
  })

export interface CommitSummary {
  filename: string
  tradesInserted: number
  tradesRestated: number
  dividendsInserted: number
  snapshotsInserted: number
  duplicatesSkipped: number
  errors: number
}

export interface CommitResult {
  files: CommitSummary[]
  /** Days whose order was refused, with why. The trades themselves imported. */
  orderProblems: string[]
}

export const commitFiles = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator(
    (data: { files: UploadPayload[]; order?: { date: string; ids: string[] }[] }) => data,
  )
  .handler(async ({ data, context }): Promise<CommitResult> => {
    const out: CommitSummary[] = []
    // Sequential, not parallel: dividend attribution reads the trade history,
    // so a trade file must be committed before a statement that references it.
    // `orderFilesForImport` guarantees that order rather than assuming it.
    console.warn(`[import] commit ${String(data.files.length)} file(s)`)
    for (const file of orderFilesForImport(decodeChecked(data.files))) {
      const result = await commitImport(context.userId, file.filename, file.bytes)
      out.push({
        filename: file.filename,
        tradesInserted: result.tradesInserted,
        tradesRestated: result.tradesRestated,
        dividendsInserted: result.dividendsInserted,
        snapshotsInserted: result.snapshotsInserted,
        duplicatesSkipped: result.duplicatesSkipped,
        errors: result.errors,
      })
    }

    // After every file, because an order can span rows from several of them.
    // Each day is its own write: one refused order must not undo the import.
    const orderProblems: string[] = []
    for (const day of data.order ?? []) {
      const applied = await setDayOrder(context.userId, day.date, day.ids)
      if (!applied.ok) orderProblems.push(`${day.date}: ${applied.message}`)
    }
    return { files: out, orderProblems }
  })
