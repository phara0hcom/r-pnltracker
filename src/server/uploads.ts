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
import { orderFilesForImport } from '~/lib/import/plan'

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
        data.files
          .map((file) => `${file.filename} (${String(file.base64.length)} b64 chars)`)
          .join(', '),
    )
    const out: PreviewSummary[] = []
    // Previewed in the order they will actually be committed, so the summary
    // describes the run the user is about to approve.
    for (const file of orderFilesForImport(decodeChecked(data.files))) {
      const preview = await previewImport(context.userId, file.filename, file.bytes)
      out.push({
        filename: preview.filename,
        format: preview.format,
        summary: preview.summary,
        newTrades: preview.plan.newTrades.length,
        newDividends: preview.plan.newDividends.length,
        duplicates: preview.plan.duplicateTrades + preview.plan.duplicateDividends,
        snapshots: preview.snapshotCount,
        cash: preview.cashCount,
        errors: preview.plan.errors.map((error) => ({ line: error.line, message: error.message })),
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
    // `orderFilesForImport` guarantees that order rather than assuming it.
    console.warn(`[import] commit ${String(data.files.length)} file(s)`)
    for (const file of orderFilesForImport(decodeChecked(data.files))) {
      const result = await commitImport(context.userId, file.filename, file.bytes)
      out.push({
        filename: file.filename,
        tradesInserted: result.tradesInserted,
        dividendsInserted: result.dividendsInserted,
        snapshotsInserted: result.snapshotsInserted,
        duplicatesSkipped: result.duplicatesSkipped,
        errors: result.errors,
      })
    }
    return out
  })
