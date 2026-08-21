import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import styles from './import.module.scss'
import { PageHeader, Section, Table } from '~/components/screen'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { cx } from '~/lib/cx'
import {
  commitFiles,
  previewFiles,
  type CommitSummary,
  type PreviewSummary,
  type UploadPayload,
} from '~/server/uploads'

export const Route = createFileRoute('/_authed/import')({
  component: Import,
})

/**
 * Anything larger is not a Rakuten export and would bloat the request body.
 *
 * Kept in step with the same ceiling in `server/uploads.ts`, which is the one
 * that actually enforces it — this check only saves the round trip.
 */
const MAX_FILE_BYTES = 5 * 1024 * 1024

/** Files are read as base64 so Shift-JIS bytes survive JSON transport unaltered. */
async function toPayload(file: File): Promise<UploadPayload> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  // Chunked rather than one call: String.fromCharCode(...bytes) blows the
  // argument limit on files of any size.
  const CHUNK = 8192
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return { filename: file.name, base64: btoa(binary) }
}

interface Staged {
  file: File
  problem?: string
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

function Import() {
  const queryClient = useQueryClient()
  /** Chosen but not yet sent. Nothing leaves the browser until Upload is clicked. */
  const [staged, setStaged] = useState<Staged[]>([])
  const [preview, setPreview] = useState<PreviewSummary[] | null>(null)
  const [payloads, setPayloads] = useState<UploadPayload[]>([])
  const [result, setResult] = useState<CommitSummary[] | null>(null)
  const [dragging, setDragging] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const doPreview = useMutation({
    mutationFn: (files: UploadPayload[]) => previewFiles({ data: { files } }),
    onSuccess: (result) => {
      setPreview(result)
      setResult(null)
      setFailure(null)
    },
    // Without this a server error renders nothing at all and the screen simply
    // looks inert — which is exactly how this failed before.
    onError: (error: Error) => {
      setFailure(
        `${error.message || 'The server rejected the upload.'} — if this persists, reload the page: a stale tab can hold a client build the dev server no longer recognises.`,
      )
    },
  })

  const doCommit = useMutation({
    mutationFn: (files: UploadPayload[]) => commitFiles({ data: { files } }),
    onSuccess: (result) => {
      setResult(result)
      setPreview(null)
      setStaged([])
      setPayloads([])
      setFailure(null)
      void queryClient.invalidateQueries()
    },
    onError: (error: Error) => {
      setFailure(error.message || 'The import failed. Nothing was written.')
    },
  })

  /** Stage files locally. Deliberately does not send anything. */
  const stage = (fileList: FileList | null) => {
    if (!fileList?.length) return
    setFailure(null)
    setPreview(null)
    setResult(null)

    const next = Array.from(fileList).map((file): Staged => {
      if (file.size === 0) return { file, problem: 'empty file' }
      if (file.size > MAX_FILE_BYTES) return { file, problem: 'too large' }
      if (!file.name.toLowerCase().endsWith('.csv')) return { file, problem: 'not a .csv' }
      return { file }
    })

    // Adding to the existing selection rather than replacing it, so several
    // drops can be combined before uploading.
    setStaged((prev) => {
      const seen = new Set(prev.map((staged) => `${staged.file.name}:${String(staged.file.size)}`))
      return [...prev, ...next.filter((staged) => !seen.has(`${staged.file.name}:${String(staged.file.size)}`))]
    })
  }

  const upload = async () => {
    const usable = staged.filter((staged) => !staged.problem)
    if (usable.length === 0) return
    setFailure(null)
    try {
      const list = await Promise.all(usable.map((staged) => toPayload(staged.file)))
      setPayloads(list)
      doPreview.mutate(list)
    } catch (error) {
      setFailure(`Could not read the file: ${(error as Error).message}`)
    }
  }

  const usableCount = staged.filter((staged) => !staged.problem).length
  const totalNew = preview?.reduce((running, file) => running + file.newTrades + file.newDividends, 0) ?? 0
  const totalDupes = preview?.reduce((running, file) => running + file.duplicates, 0) ?? 0
  const busy = doPreview.isPending || doCommit.isPending

  return (
    <>
      <PageHeader
        title="Import"
        meta="Rakuten tradehistory (JP / US / INVST) and 取引残高報告書 CSVs. Re-importing is safe — duplicates are skipped."
      />

      {/* Drag-and-drop is an enhancement; the file input inside is the real,
          keyboard-accessible control, so this wrapper is only a drop target. */}
      <div
        className={cx(styles.drop, dragging && styles.dropActive)}
        role="presentation"
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => {
          setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          stage(event.dataTransfer.files)
        }}
      >
        <p className={styles.dropText}>Drop CSV files here</p>
        <label className={styles.fileButton}>
          <input
            type="file"
            multiple
            accept=".csv"
            className="visually-hidden"
            onChange={(event) => {
              stage(event.target.files)
              // Reset so re-choosing the same file still fires a change event.
              event.target.value = ''
            }}
          />
          Choose files
        </label>
        <p className={styles.dropHint}>
          Nothing is sent until you press Upload, and nothing is written until you confirm.
        </p>
      </div>

      {failure ? (
        <div className={styles.failure} role="alert">
          <strong>Upload failed.</strong> {failure}
        </div>
      ) : null}

      {staged.length > 0 ? (
        <Section title="Selected files">
          <ul className={styles.stagedList}>
            {staged.map((staged) => (
              <li key={`${staged.file.name}:${String(staged.file.size)}`} className={styles.stagedItem}>
                <span className={styles.stagedName}>{staged.file.name}</span>
                <span className={styles.stagedSize}>{kb(staged.file.size)}</span>
                {staged.problem ? <span className={styles.stagedProblem}>{staged.problem}</span> : null}
                <button
                  type="button"
                  className={styles.removeButton}
                  aria-label={`Remove ${staged.file.name}`}
                  onClick={() => {
                    setStaged((prev) => prev.filter((item) => item.file !== staged.file))
                    setPreview(null)
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <div className={styles.actions}>
            <span className={styles.summary}>
              {usableCount} file{usableCount === 1 ? '' : 's'} ready
              {staged.length - usableCount > 0
                ? `, ${String(staged.length - usableCount)} skipped`
                : ''}
            </span>
            <ConfirmButton
              confirmLabel="Clear all?"
              onConfirm={() => {
                setStaged([])
                setPreview(null)
                setFailure(null)
              }}
            >
              Clear
            </ConfirmButton>
            <button
              type="button"
              className={styles.primary}
              disabled={usableCount === 0 || busy}
              onClick={() => {
                void upload()
              }}
            >
              {doPreview.isPending ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </Section>
      ) : null}

      {preview ? (
        <Section
          title="Preview"
          description="Nothing has been written yet. This is exactly what importing would change."
        >
          <Table>
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Format</th>
                <th scope="col" data-numeric>New trades</th>
                <th scope="col" data-numeric>New dividends</th>
                <th scope="col" data-numeric>Duplicates</th>
                <th scope="col" data-numeric>Snapshots</th>
                <th scope="col" data-numeric>Errors</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((filePreview) => (
                <tr key={filePreview.filename}>
                  <td>{filePreview.filename}</td>
                  <td>{filePreview.format}</td>
                  <td data-numeric>{filePreview.newTrades}</td>
                  <td data-numeric>{filePreview.newDividends}</td>
                  <td data-numeric className={styles.dim}>{filePreview.duplicates}</td>
                  <td data-numeric>{filePreview.snapshots}</td>
                  <td data-numeric className={filePreview.errors.length ? styles.loss : undefined}>
                    {filePreview.errors.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>

          {preview.some((filePreview) => filePreview.errors.length > 0) ? (
            <div className={styles.errors}>
              <h3 className={styles.errorTitle}>Unreadable rows</h3>
              <ul>
                {preview.flatMap((filePreview) =>
                  filePreview.errors.slice(0, 8).map((rowError, index) => (
                    <li key={`${filePreview.filename}-${String(index)}`}>
                      <code>{filePreview.filename}</code>
                      {rowError.line > 0 ? ` line ${String(rowError.line)}` : ''}: {rowError.message}
                    </li>
                  )),
                )}
              </ul>
              <p className={styles.dropHint}>
                These rows are skipped; everything else still imports.
              </p>
            </div>
          ) : null}

          <div className={styles.actions}>
            <span className={styles.summary}>
              {totalNew} new record{totalNew === 1 ? '' : 's'}
              {totalDupes > 0 ? `, ${String(totalDupes)} already imported` : ''}
            </span>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setPreview(null)
              }}
            >
              Back
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={busy || totalNew === 0}
              onClick={() => {
                doCommit.mutate(payloads)
              }}
            >
              {doCommit.isPending
                ? 'Importing…'
                : totalNew === 0
                  ? 'Nothing new to import'
                  : `Import ${String(totalNew)}`}
            </button>
          </div>
        </Section>
      ) : null}

      {result ? (
        <Section title="Imported">
          <Table>
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col" data-numeric>Trades</th>
                <th scope="col" data-numeric>Dividends</th>
                <th scope="col" data-numeric>Snapshots</th>
                <th scope="col" data-numeric>Skipped</th>
              </tr>
            </thead>
            <tbody>
              {result.map((result) => (
                <tr key={result.filename}>
                  <td>{result.filename}</td>
                  <td data-numeric>{result.tradesInserted}</td>
                  <td data-numeric>{result.dividendsInserted}</td>
                  <td data-numeric>{result.snapshotsInserted}</td>
                  <td data-numeric className={styles.dim}>{result.duplicatesSkipped}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      ) : null}
    </>
  )
}
