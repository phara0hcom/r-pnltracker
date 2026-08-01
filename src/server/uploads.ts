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

export interface PreviewSummary {
  filename: string
  format: string
  summary: string
  newTrades: number
  newDividends: number
  duplicates: number
  snapshots: number
  cash: number
  errors: { line: number; message: string }[]
}

export const previewFiles = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: { files: UploadPayload[] }) => data)
  .handler(async ({ data, context }): Promise<PreviewSummary[]> => {
    // Logged so a failed upload leaves a trace in the dev server output rather
    // than only in the browser.
    console.warn(
      `[import] preview ${String(data.files.length)} file(s): ` +
        data.files.map((f) => `${f.filename} (${String(f.base64.length)} b64 chars)`).join(', '),
    )
    const out: PreviewSummary[] = []
    for (const f of data.files) {
      const p = await previewImport(context.userId, f.filename, decode(f.base64))
      out.push({
        filename: p.filename,
        format: p.format,
        summary: p.summary,
        newTrades: p.plan.newTrades.length,
        newDividends: p.plan.newDividends.length,
        duplicates: p.plan.duplicateTrades + p.plan.duplicateDividends,
        snapshots: p.snapshotCount,
        cash: p.cashCount,
        errors: p.plan.errors.map((e) => ({ line: e.line, message: e.message })),
      })
    }
    return out
  })

export interface CommitSummary {
  filename: string
  tradesInserted: number
  dividendsInserted: number
  snapshotsInserted: number
  duplicatesSkipped: number
  errors: number
}

export const commitFiles = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: { files: UploadPayload[] }) => data)
  .handler(async ({ data, context }): Promise<CommitSummary[]> => {
    const out: CommitSummary[] = []
    // Sequential, not parallel: dividend attribution reads the trade history,
    // so a trade file must be committed before a statement that references it.
    console.warn(`[import] commit ${String(data.files.length)} file(s)`)
    for (const f of data.files) {
      const r = await commitImport(context.userId, f.filename, decode(f.base64))
      out.push({
        filename: f.filename,
        tradesInserted: r.tradesInserted,
        dividendsInserted: r.dividendsInserted,
        snapshotsInserted: r.snapshotsInserted,
        duplicatesSkipped: r.duplicatesSkipped,
        errors: r.errors,
      })
    }
    return out
  })
