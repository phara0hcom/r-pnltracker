/**
 * The positions, as a table on a desktop and cards on a phone.
 *
 * Sorting is client-side over rows already in memory. Result sorts by its yen, the
 * way the dashboard totals across markets; a paper position has no yen, so on the
 * Paper view it sorts by return.
 */
import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import styles from './PositionTable.module.scss'
import { AccountDot } from '~/components/AccountDot'
import { ExitFlags } from '~/components/exits/ExitFlags'
import { ExitLadder } from '~/components/exits/ExitLadder'
import { ACCOUNT_LABEL, moneySigned, pctSigned, tone, yenSigned } from '~/components/format'
import { Empty, SortHeader, Table } from '~/components/screen'
import { useIsMobile } from '~/components/ui/useIsMobile'
import { cx } from '~/lib/cx'
import type { PositionStatus } from '~/lib/playbook/types'
import type { KindFilter, PlaybookSortKey } from '~/lib/playbookSearch'
import { sortRows, type SortColumn, type SortDir } from '~/lib/sortRows'
import type { PositionRow } from '~/server/playbook'

export const STATUS_LABEL: Record<PositionStatus, string> = {
  AWAITING_IMPORT: 'Awaiting import',
  OPEN: 'Open',
  CLOSED: 'Closed',
  MISSING: 'Trades not found',
}

const STATUS_CLASS: Record<PositionStatus, string | undefined> = {
  AWAITING_IMPORT: styles.statusWaiting,
  OPEN: styles.statusOpen,
  CLOSED: styles.statusClosed,
  MISSING: styles.statusMissing,
}

export function StatusBadge({ status }: { status: PositionStatus }) {
  return <span className={cx(styles.status, STATUS_CLASS[status])}>{STATUS_LABEL[status]}</span>
}

const toneClass = (value: string | number | null | undefined) => {
  const name = tone(value)
  return name === 'flat' ? undefined : styles[name]
}

/** Dollars with the yen in brackets on a US close; a paper trade in its own currency. */
export function ResultText({ row }: { row: Pick<PositionRow, 'result' | 'resultJpy' | 'currency' | 'returnPct' | 'kind'> }) {
  if (row.result === null) return <>—</>
  if (row.currency === 'USD' && row.resultJpy !== null) {
    return (
      <>
        {moneySigned(row.result, 'USD')} <span className={styles.aside}>({yenSigned(row.resultJpy)})</span>
      </>
    )
  }
  return (
    <>
      {moneySigned(row.result, row.currency)}
      {row.kind === 'PAPER' ? <span className={styles.aside}> {pctSigned(row.returnPct)}</span> : null}
    </>
  )
}

/** The `*` on a provisional score, explained to a screen reader rather than left as a symbol. */
export function ScoreText({ value, provisional }: { value: string | null; provisional: boolean }) {
  if (value === null) return <>—</>
  return (
    <>
      {value}
      {provisional ? (
        <span title="Provisional: a part is missing or the position is still open">
          <span aria-hidden="true">*</span>
          <span className="visually-hidden"> provisional</span>
        </span>
      ) : null}
    </>
  )
}

const columnsFor = (kind: KindFilter): Record<PlaybookSortKey, SortColumn<PositionRow>> => ({
  symbol: { value: (row) => row.symbol },
  setup: { value: (row) => row.setupName },
  status: { value: (row) => STATUS_LABEL[row.status] },
  opened: { value: (row) => row.openDate },
  closed: { value: (row) => row.closeDate },
  result: { numeric: true, value: (row) => (kind === 'PAPER' ? row.returnPct : row.resultJpy) },
  r: { numeric: true, value: (row) => row.r },
  entry: { numeric: true, value: (row) => row.entryScore },
  exit: { numeric: true, value: (row) => row.exitScore },
  risk: { numeric: true, value: (row) => row.riskScore },
  overall: { numeric: true, value: (row) => row.overall },
})

const HEADERS: { key: PlaybookSortKey; label: string; numeric?: boolean }[] = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'setup', label: 'Setup' },
  { key: 'status', label: 'Status' },
  { key: 'opened', label: 'Opened' },
  { key: 'closed', label: 'Closed' },
  { key: 'result', label: 'Result', numeric: true },
  { key: 'r', label: 'R', numeric: true },
  { key: 'entry', label: 'Entry', numeric: true },
  { key: 'exit', label: 'Exit', numeric: true },
  { key: 'risk', label: 'Risk', numeric: true },
  { key: 'overall', label: 'Overall', numeric: true },
]

const shortDate = (date: string | null) => (date === null ? '—' : date.slice(5).replace('-', '/'))

function Identity({ row }: { row: PositionRow }) {
  return (
    <>
      <Link to="/playbook/$journalId" params={{ journalId: row.id }} className={styles.rowLink}>
        {row.symbol} <span className={styles.name}>{row.name}</span>
      </Link>
      <span className={styles.sub}>
        {row.accountType ? <AccountDot accountType={row.accountType} /> : null}
        {row.kind === 'PAPER' ? 'Paper' : (ACCOUNT_LABEL[row.accountType ?? ''] ?? '')}
      </span>
    </>
  )
}

function StatusCell({ row, onLink }: { row: PositionRow; onLink: (row: PositionRow) => void }) {
  return (
    <span className={styles.statusCell}>
      <StatusBadge status={row.status} />
      {row.linkable ? (
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => {
            onLink(row)
          }}
        >
          Trades found — link<span className="visually-hidden"> {row.symbol}</span>
        </button>
      ) : null}
      {row.plan && row.status !== 'CLOSED' ? (
        <>
          <ExitFlags row={row.plan} compact />
          <ExitLadder row={row.plan} className={styles.ladder} />
        </>
      ) : null}
    </span>
  )
}

export function PositionTable({
  rows,
  kind,
  sortBy,
  sortDir,
  onSort,
  onLink,
}: {
  rows: PositionRow[]
  kind: KindFilter
  sortBy: PlaybookSortKey | undefined
  sortDir: SortDir
  onSort: (key: PlaybookSortKey) => void
  onLink: (row: PositionRow) => void
}) {
  const isMobile = useIsMobile()
  const sorted = useMemo(
    () => (sortBy ? sortRows(rows, columnsFor(kind), sortBy, sortDir) : rows),
    [rows, kind, sortBy, sortDir],
  )

  if (rows.length === 0) return <Empty>No positions match these filters.</Empty>

  if (isMobile) {
    return (
      <ul className={styles.cards}>
        {sorted.map((row) => (
          <li key={row.id} className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardWho}>
                <Identity row={row} />
              </span>
              <span className={cx(styles.cardResult, toneClass(row.result))}>
                <ResultText row={row} />
              </span>
            </div>
            <StatusCell row={row} onLink={onLink} />
            <p className={styles.cardMeta}>
              {row.setupName ?? 'No setup'} · {shortDate(row.openDate)}
              {row.closeDate ? ` → ${shortDate(row.closeDate)}` : ''}
              {row.r ? ` · ${row.r}R` : ''}
            </p>
            <p className={styles.cardMeta}>
              Entry {row.entryScore ?? '—'} · Exit {row.exitScore ?? '—'} · Risk {row.riskScore ?? '—'} · Overall{' '}
              <ScoreText value={row.overall} provisional={row.provisional} />
            </p>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <Table caption="Playbook positions, one row per holding streak">
      <thead>
        <tr>
          {HEADERS.map((header) => (
            <SortHeader
              key={header.key}
              col={header.key}
              label={header.label}
              numeric={header.numeric}
              sortBy={sortBy ?? ('' as PlaybookSortKey)}
              sortDir={sortDir}
              onSort={onSort}
            />
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={row.id} className={styles.row}>
            <td>
              <Identity row={row} />
            </td>
            <td>{row.setupName ?? '—'}</td>
            <td>
              <StatusCell row={row} onLink={onLink} />
            </td>
            <td>{shortDate(row.openDate)}</td>
            <td>{shortDate(row.closeDate)}</td>
            <td
              data-numeric=""
              className={toneClass(row.result)}
              title={row.currency === 'USD' ? 'Dollars as Rakuten shows them; the yen includes the currency move' : undefined}
            >
              <ResultText row={row} />
            </td>
            <td
              data-numeric=""
              className={toneClass(row.r)}
              title={row.currency === 'USD' && row.r ? 'After both commissions, so slightly below what the dollar figure implies' : undefined}
            >
              {row.r === null ? '—' : `${row.r}R`}
            </td>
            <td data-numeric="">{row.entryScore ?? '—'}</td>
            <td data-numeric="">{row.exitScore ?? '—'}</td>
            <td data-numeric="">{row.riskScore ?? '—'}</td>
            <td data-numeric="">
              <ScoreText value={row.overall} provisional={row.provisional} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
