/**
 * Open positions, grouped by account.
 *
 * Sorting is client-side over rows already in memory: the account filter is a
 * loader dependency and sorting deliberately is not, so clicking a header
 * reorders instantly rather than making a round trip for the same rows back in
 * a different order. It orders rows within each account; the accounts keep
 * their own order, largest first, so a sort never scatters one account's
 * holdings among another's.
 *
 * Every total — the book, each account, each row's weight — is summed on the
 * server. This screen used to add them up in the browser from the strings the
 * server had kept exact on purpose.
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import styles from './positions.module.scss'
import { AccountDot } from '~/components/AccountDot'
import {
  ACCOUNT_LABEL,
  ACCOUNT_TITLE,
  ASSET_LABEL,
  ASSET_TAG,
  money,
  moneySigned,
  pct,
  pctSigned,
  qty,
  tone,
  yen,
  yenSigned,
} from '~/components/format'
import { InstrumentLink } from '~/components/InstrumentLink'
import { PositionsSummary, UnpricedNotice } from '~/components/positions/PositionsSummary'
import { Empty, PageHeader, SegmentedTabs, SortHeader, Table } from '~/components/screen'
import { AccountFilterControl } from '~/components/ui/AccountFilterControl'
import { useAccountFilter } from '~/components/ui/AccountSwitch'
import { ColumnMenu } from '~/components/ui/ColumnMenu'
import { ExportButton } from '~/components/ui/ExportButton'
import { useColumnVisibility } from '~/components/ui/useColumnVisibility'
import { useIsMobile } from '~/components/ui/useIsMobile'
import { cx } from '~/lib/cx'
import type { AccountFilter } from '~/lib/domain/types'
import { positionsCsv, positionsCsvFilename } from '~/lib/export/positionsCsv'
import type { AccountTotal, PositionTotal } from '~/lib/pnl/positionSummary'
import { POSITION_SORTABLE, positionSearchSchema, type PositionSortKey } from '~/lib/positionSearch'
import { nextSort, sortRows, type SortColumn } from '~/lib/sortRows'
import type { TableColumn } from '~/lib/table/columns'
import { getPositions, type PositionRow, type PositionsData } from '~/server/screens'

interface PositionColumn extends SortColumn<PositionRow> {
  label: string
  numeric?: boolean
  /**
   * Always shown. Symbol names the row, and quantity and price are what make it
   * a holding rather than a watchlist entry — a row missing any of the three
   * cannot be read.
   */
  locked?: boolean
  /** The cell's content. */
  cell: (row: PositionRow) => React.ReactNode
  /** Profit/loss tint, or the muted tone of a supporting figure. */
  tint?: (row: PositionRow) => string | undefined
  /** The account's or the book's figure, for the columns that total. */
  total?: (total: PositionTotal) => React.ReactNode
  /** The total's tint. */
  totalTint?: (total: PositionTotal) => string | undefined
}

/**
 * A US position's figure: dollars first — the currency it is held and judged
 * in — with its yen at today's rate beneath. A close's yen uses its sale rate;
 * a position still held has none yet.
 */
function Dual({
  usd,
  jpy,
  signed = false,
  title,
}: {
  usd: string
  jpy: string | null
  signed?: boolean
  title?: string
}) {
  return (
    <span title={title}>
      {signed ? moneySigned(usd, 'USD') : money(usd, 'USD')}
      {jpy == null ? null : (
        <span className={styles.aside}>({signed ? yenSigned(jpy) : yen(jpy)})</span>
      )}
    </span>
  )
}

/**
 * A price as the instrument is quoted: dollars or yen a share, or for a fund
 * yen per 10,000 口, marked so — ¥37,410 for one 口 would be absurd.
 */
function Quoted({ row, value }: { row: PositionRow; value: string }) {
  return (
    <>
      {money(value, row.currency)}
      {row.assetClass === 'FUND' ? <span className={styles.unit}>/万口</span> : null}
    </>
  )
}

const quantityOf = (row: PositionRow) =>
  row.assetClass === 'FUND' ? `${qty(row.quantity)} 口` : qty(row.quantity)

/**
 * The tint class for a signed figure, or nothing where it has no direction.
 *
 * `tone` answers 'flat' for a zero and for a missing figure alike, and there is
 * no `.flat` rule for it to match — handing it to a cell's `className` puts a
 * class in the DOM that styles nothing.
 */
const toneClass = (value: string | number | null | undefined): string | undefined => {
  const name = tone(value)
  return name === 'flat' ? undefined : styles[name]
}

const unrealizedTitle = (row: PositionRow) =>
  [
    `On price: (price − average buy) × shares, before commission`,
    row.usdJpy == null ? null : `Yen at ¥${row.usdJpy}/$`,
    row.unrealizedTaxJpy == null
      ? null
      : `For tax: ${yenSigned(row.unrealizedTaxJpy)}, against the yen paid at each buy's rate`,
  ]
    .filter((line) => line != null)
    .join('\n')

/**
 * Label, alignment, sort value, cell and total for each column, keyed by its
 * sort key.
 *
 * One definition drives the header row, the body, the account rows, the total
 * and the caption, all rendered in `POSITION_SORTABLE` order — so a column
 * cannot end up labelled one thing and sorted by another.
 *
 * Every money field arrives as an exact decimal string, hence `numeric` on all
 * of them: compared as text, "9" would sort above "10".
 */
const COLUMNS: Record<PositionSortKey, PositionColumn> = {
  symbol: {
    label: 'Instrument',
    locked: true,
    value: (row) => row.symbol,
    cell: (row) => (
      <InstrumentLink
        symbol={row.symbol}
        name={row.name}
        assetClass={row.assetClass}
        badge={ASSET_TAG[row.assetClass]}
      />
    ),
  },
  quantity: {
    label: 'Qty',
    numeric: true,
    locked: true,
    value: (row) => row.quantity,
    cell: quantityOf,
  },
  /*
   * Avg cost and Price render the quoted figure — $150 sits in the same column
   * as ¥3,000 — and sort on exactly that. The alternative, sorting a USD row by
   * a hidden JPY equivalent, would order the table by numbers it does not show.
   * The yen columns beside them are the ones that compare across the book.
   */
  avgCost: {
    label: 'Avg cost',
    numeric: true,
    value: (row) => row.avgPriceQuoted,
    cell: (row) => <Quoted row={row} value={row.avgPriceQuoted} />,
    tint: () => styles.muted,
  },
  price: {
    label: 'Price',
    numeric: true,
    locked: true,
    value: (row) => row.priceQuoted,
    cell: (row) =>
      row.priceQuoted == null ? (
        <span className={styles.noPrice}>No price</span>
      ) : (
        <Quoted row={row} value={row.priceQuoted} />
      ),
  },
  costBasisJpy: {
    label: 'Cost basis',
    numeric: true,
    // Sorted by the yen beneath a US figure, so the column still compares
    // across the whole book.
    value: (row) => row.costShownJpy,
    cell: (row) =>
      row.costUsd == null ? (
        yen(row.costBasisJpy)
      ) : (
        <Dual
          usd={row.costUsd}
          jpy={row.costShownJpy}
          title={`Paid ${yen(row.costBasisJpy)}, each buy in yen at its own day's rate — the tax cost basis`}
        />
      ),
    total: (total) => yen(total.costShownJpy),
  },
  marketValueJpy: {
    label: 'Value',
    numeric: true,
    value: (row) => row.marketValueJpy,
    cell: (row) =>
      row.marketValueUsd == null ? (
        yen(row.marketValueJpy)
      ) : (
        <Dual usd={row.marketValueUsd} jpy={row.marketValueJpy} />
      ),
    tint: () => styles.strong,
    total: (total) => yen(total.marketValueJpy),
  },
  weight: {
    label: 'Weight',
    numeric: true,
    value: (row) => row.weight,
    cell: (row) => pct(row.weight),
    tint: () => styles.muted,
    total: (total) => pct(total.weight),
    totalTint: () => styles.muted,
  },
  unrealizedJpy: {
    label: 'Unrealized',
    numeric: true,
    value: (row) => row.unrealizedJpy,
    cell: (row) =>
      row.unrealizedUsd == null ? (
        yenSigned(row.unrealizedJpy)
      ) : (
        <Dual usd={row.unrealizedUsd} jpy={row.unrealizedJpy} signed title={unrealizedTitle(row)} />
      ),
    tint: (row) => toneClass(row.unrealizedJpy),
    total: (total) => yenSigned(total.unrealizedJpy),
    totalTint: (total) => toneClass(total.unrealizedJpy),
  },
  unrealizedPct: {
    label: '%',
    numeric: true,
    value: (row) => row.unrealizedPct,
    cell: (row) => pctSigned(row.unrealizedPct),
    // Tinted off the yen figure, not the percentage, so the two cells always
    // agree — `pctSigned` shows a dash where `unrealizedPct` is null.
    tint: (row) => toneClass(row.unrealizedJpy),
    total: (total) => pctSigned(total.unrealizedPct),
    totalTint: (total) => toneClass(total.unrealizedJpy),
  },
}

/**
 * The picker's list, derived from `COLUMNS` rather than written again beside
 * it — a second list is a second thing to update when a column is renamed.
 */
const PICKER: TableColumn<PositionSortKey>[] = POSITION_SORTABLE.map((key) => ({
  key,
  label: COLUMNS[key].label,
  locked: COLUMNS[key].locked,
}))

/**
 * The three orderings the SP card list offers.
 *
 * A subset, not the full column list: a phone has room for three buttons, and
 * these are the three a holdings list is actually read by. Tapping the active
 * one flips its direction, like a header does.
 */
const SP_SORT_KEYS = ['marketValueJpy', 'unrealizedJpy', 'unrealizedPct'] as const
const SP_SORTS = SP_SORT_KEYS.map((key) => ({ id: key, label: COLUMNS[key].label }))

type SpSortKey = (typeof SP_SORT_KEYS)[number]

/**
 * Whether the active sort is one the SP control can show as pressed.
 *
 * A guard rather than a bare `.includes`, which does not narrow: sorting by a
 * column the phone does not offer (arrived at on desktop, then carried here in
 * the URL) has to leave the control showing something, and Value is the
 * default the server already orders by.
 */
const isSpSortKey = (key: PositionSortKey): key is SpSortKey =>
  (SP_SORT_KEYS as readonly string[]).includes(key)

export const Route = createFileRoute('/_authed/positions')({
  validateSearch: positionSearchSchema,
  // The account filter is a loader dependency, so changing it refetches rather
  // than re-rendering the previous account's figures. Sort is pointedly absent:
  // it reorders rows the client already has.
  loaderDeps: ({ search }) => ({ account: search.scope ?? 'ALL' }),
  loader: ({ deps }) => getPositions({ data: { account: deps.account } }),
  component: Positions,
})

interface Group {
  /** Null when the screen shows one account and needs no headings. */
  total: AccountTotal | null
  rows: PositionRow[]
}

/**
 * The sorted rows cut into accounts, in the server's account order.
 *
 * Under 特定 there is one account and a heading repeating the filter would
 * say nothing, so the rows stay one list.
 */
function groupRows(data: PositionsData, sorted: PositionRow[], account: AccountFilter): Group[] {
  if (account === 'SPECIFIC') return [{ total: null, rows: sorted }]
  return data.accounts.map((entry) => ({
    total: entry,
    rows: sorted.filter((row) => row.accountType === entry.accountType),
  }))
}

const positionsLabel = (count: number) => `${String(count)} position${count === 1 ? '' : 's'}`

/**
 * An account's heading row, or the book's total at the foot: the label across
 * the columns with no total, then each shown column's own total beneath it.
 */
function TotalRow({
  total,
  label,
  scope,
  leading,
  totalled,
  className,
}: {
  total: PositionTotal
  label: React.ReactNode
  /** `rowgroup` for an account's heading, which labels the rows under it. */
  scope: 'row' | 'rowgroup'
  leading: number
  totalled: readonly PositionSortKey[]
  className: string | undefined
}) {
  return (
    <tr className={className}>
      <th scope={scope} colSpan={leading}>
        {label}
      </th>
      {totalled.map((key) => (
        <td key={key} data-numeric="" className={COLUMNS[key].totalTint?.(total)}>
          {COLUMNS[key].total?.(total)}
        </td>
      ))}
    </tr>
  )
}

/** The account's dot, full name and holding count. */
function GroupName({ total }: { total: AccountTotal }) {
  return (
    <span className={styles.groupName}>
      <AccountDot accountType={total.accountType} />
      {ACCOUNT_TITLE[total.accountType] ?? total.accountType}
      <span className={styles.groupCount}>{positionsLabel(total.count)}</span>
    </span>
  )
}

/** SP: one holding as two lines — what it is and is worth, then how many at what. */
function PositionCard({ row }: { row: PositionRow }) {
  const isFund = row.assetClass === 'FUND'
  const avg = `avg ${money(row.avgPriceQuoted, row.currency)}`
  const detail = isFund
    ? row.priceQuoted == null
      ? `${quantityOf(row)} · ${avg}`
      : `${money(row.priceQuoted, row.currency)}/万口 · ${avg}`
    : row.priceQuoted == null
      ? `${qty(row.quantity)} · ${avg}`
      : `${qty(row.quantity)} × ${money(row.priceQuoted, row.currency)} · ${avg}`
  const tint = toneClass(row.unrealizedJpy)

  return (
    <li className={styles.card}>
      <span className={styles.cardWho}>
        <span className={styles.cardSymbol}>{row.symbol}</span>
        {isFund ? null : <span className={styles.cardName}>{row.name}</span>}
      </span>
      <span className={styles.cardValue}>{row.marketValueJpy == null ? '—' : yen(row.marketValueJpy)}</span>
      <span className={styles.cardDetail}>{detail}</span>
      {row.marketValueJpy == null ? (
        <span className={styles.cardResult}>
          <span className={styles.noPrice}>No price</span>
        </span>
      ) : (
        <span className={cx(styles.cardResult, tint)}>
          {/* A US holding in dollars, as it is judged; its yen is in the table. */}
          {row.unrealizedUsd == null ? yenSigned(row.unrealizedJpy) : moneySigned(row.unrealizedUsd, 'USD')}{' '}
          <span className={styles.cardPct}>{pctSigned(row.unrealizedPct)}</span>
        </span>
      )}
    </li>
  )
}

function Positions() {
  const initial = Route.useLoaderData()
  const { sortBy, sortDir } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [account, setAccount] = useAccountFilter()
  const isMobile = useIsMobile()
  const { data } = useQuery({
    queryKey: ['positions', account],
    queryFn: () => getPositions({ data: { account } }),
    initialData: initial,
  })
  const { rows, total } = data

  // `replace: true` — re-sorting is refining one view, not a new destination, so
  // Back should leave the screen rather than walk back through every column you
  // tried.
  const onSort = useCallback(
    (col: PositionSortKey) => {
      void navigate({
        search: (prev) => ({ ...prev, ...nextSort(col, sortBy, sortDir) }),
        replace: true,
      })
    },
    [navigate, sortBy, sortDir],
  )

  const columns = useColumnVisibility('positions', PICKER)
  // The rendered order stays `POSITION_SORTABLE`'s, filtered — so re-showing a
  // column puts it back where it was rather than appending it.
  const shown = useMemo(
    () => POSITION_SORTABLE.filter((key) => columns.visible.has(key)),
    [columns.visible],
  )
  // The account and total rows put their label across the columns that have
  // no total, which all come before the first that has one.
  const leading = shown.filter((key) => COLUMNS[key].total == null).length
  const totalled = shown.filter((key) => COLUMNS[key].total != null)

  const sorted = useMemo(() => sortRows(rows, COLUMNS, sortBy, sortDir), [rows, sortBy, sortDir])
  const groups = useMemo(() => groupRows(data, sorted, account), [data, sorted, account])

  // The file is the table as it reads — account by account, each in the
  // chosen order — so a spreadsheet opened beside the screen matches it.
  const exportFile = useCallback(
    () => ({
      filename: positionsCsvFilename(account),
      body: positionsCsv(
        groups.flatMap((group) => group.rows),
        { account: ACCOUNT_LABEL, assetClass: ASSET_LABEL },
      ),
    }),
    [groups, account],
  )

  const meta = [
    `${String(total.count)} open`,
    total.unpriced > 0 ? `${String(total.unpriced)} without a price` : null,
    data.usdJpy == null ? null : `US at ¥${data.usdJpy}/$`,
  ]
    .filter((part) => part != null)
    .join(' · ')

  return (
    <>
      <PageHeader
        title="Positions"
        meta={meta}
        filter={<AccountFilterControl value={account} onChange={setAccount} />}
        actionsBeside
      >
        <ExportButton file={exportFile} disabled={rows.length === 0}>
          Export CSV
        </ExportButton>
        {isMobile ? null : (
          <ColumnMenu
            columns={PICKER}
            hidden={columns.hidden}
            hiddenCount={columns.hiddenCount}
            onToggle={columns.toggle}
            onReset={columns.reset}
          />
        )}
      </PageHeader>

      {rows.length === 0 ? (
        <Empty>No open positions.</Empty>
      ) : (
        <>
          <PositionsSummary data={data} account={account} compact={isMobile} />
          <UnpricedNotice rows={rows} cost={total.unpricedCostJpy} />

          {isMobile ? (
            <>
              {/* The card list has no headers to click, so sorting needs its own
                  control — without it SP would be the one view you cannot reorder. */}
              <div className={styles.sortControl}>
                <SegmentedTabs
                  tabs={SP_SORTS}
                  active={isSpSortKey(sortBy) ? sortBy : 'marketValueJpy'}
                  onChange={onSort}
                  label="Sort by"
                />
              </div>
              {groups.map((group) => (
                <section
                  key={group.total?.accountType ?? 'all'}
                  className={styles.cardGroup}
                  aria-label={group.total ? ACCOUNT_TITLE[group.total.accountType] : 'Positions'}
                >
                  {group.total ? (
                    <div className={styles.cardGroupHead}>
                      <GroupName total={group.total} />
                      <span className={styles.cardGroupFigures}>
                        {yen(group.total.marketValueJpy)}
                        <span className={cx(styles.cardPct, toneClass(group.total.unrealizedJpy))}>
                          {pctSigned(group.total.unrealizedPct)}
                        </span>
                      </span>
                    </div>
                  ) : null}
                  <ul className={styles.cardList}>
                    {group.rows.map((row) => (
                      <PositionCard key={`${row.symbol}-${row.accountType}`} row={row} />
                    ))}
                  </ul>
                </section>
              ))}
            </>
          ) : (
            <Table
              caption={`Positions${account === 'SPECIFIC' ? '' : ' by account'}, sorted by ${
                COLUMNS[sortBy].label
              } ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
            >
              <thead>
                <tr>
                  {shown.map((key) => (
                    <SortHeader
                      key={key}
                      col={key}
                      label={COLUMNS[key].label}
                      numeric={COLUMNS[key].numeric}
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={onSort}
                    />
                  ))}
                </tr>
              </thead>
              {groups.map((group) => (
                <tbody key={group.total?.accountType ?? 'all'} className={styles.group}>
                  {group.total ? (
                    <TotalRow
                      total={group.total}
                      label={<GroupName total={group.total} />}
                      scope="rowgroup"
                      leading={leading}
                      totalled={totalled}
                      className={styles.groupRow}
                    />
                  ) : null}
                  {group.rows.map((row) => (
                    <tr key={`${row.symbol}-${row.accountType}`}>
                      {shown.map((key) => {
                        const column = COLUMNS[key]
                        return (
                          <td
                            key={key}
                            data-numeric={column.numeric ? '' : undefined}
                            className={column.tint?.(row)}
                          >
                            {column.cell(row)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <TotalRow
                  total={total}
                  label={`Total · ${positionsLabel(total.count)}`}
                  scope="row"
                  leading={leading}
                  totalled={totalled}
                  className={styles.totalRow}
                />
              </tfoot>
            </Table>
          )}

          <p className={styles.footnote}>
            Avg cost and price are in the instrument&apos;s own currency, funds per 10,000 口 (基準価額).
            Cost basis, value and unrealized are in yen{data.usdJpy == null ? '' : ', US holdings at today’s rate'}.
            Percentages leave out holdings with no price.
          </p>
        </>
      )}
    </>
  )
}
