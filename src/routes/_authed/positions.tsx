/**
 * Open positions, by account (NISA / 特定) and, within each, by market (JP / US).
 *
 * Two independent filters narrow the book — account and market — and whichever
 * is still open becomes a heading. Account comes first, so an account's
 * holdings stay together: each account is a block, with a JP and a US
 * sub-heading inside it. Under 特定 the markets are the blocks; under one market
 * the accounts are; under both, one list. Markets are split only when both are
 * held (`splitFor`).
 *
 * The market lives only on this screen, so it is read from this route's own
 * validated search rather than through a cross-route hook like the account's.
 *
 * Sorting is client-side over rows already in memory: the two filters are
 * loader dependencies and sorting deliberately is not, so clicking a header
 * reorders instantly rather than making a round trip for the same rows back in
 * a different order. It orders rows within each block; the blocks keep their
 * own order (accounts largest first, JP before US within each), so a sort never
 * scatters one block's holdings among another's.
 *
 * Every total — the book, each account, each row's weight — is summed on the
 * server. This screen used to add them up in the browser from the strings the
 * server had kept exact on purpose.
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Fragment, useCallback, useEffect, useMemo } from 'react'
import styles from './positions.module.scss'
import { AccountDot } from '~/components/AccountDot'
import {
  ACCOUNT_LABEL,
  ACCOUNT_TITLE,
  ASSET_LABEL,
  ASSET_TAG,
  MARKET_TITLE,
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
import { ACCOUNT_OPTIONS, useAccountFilter } from '~/components/ui/AccountSwitch'
import { ColumnMenu } from '~/components/ui/ColumnMenu'
import { ExportButton } from '~/components/ui/ExportButton'
import { MarketFilterControl } from '~/components/ui/MarketFilterControl'
import { rememberMarket } from '~/components/ui/rememberedMarket'
import { useColumnVisibility } from '~/components/ui/useColumnVisibility'
import { useIsMobile } from '~/components/ui/useIsMobile'
import { cx } from '~/lib/cx'
import type { AccountFilter, AccountType, MarketFilter } from '~/lib/domain/types'
import { positionsCsv, positionsCsvFilename } from '~/lib/export/positionsCsv'
import { inGroup, inMarket, type MarketTotal, type PositionTotal } from '~/lib/pnl/positionSummary'
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
  // The account and market filters are loader dependencies, so changing either
  // refetches rather than re-rendering the previous view's figures. Sort is
  // pointedly absent: it reorders rows the client already has.
  loaderDeps: ({ search }) => ({ account: search.scope ?? 'ALL', market: search.market ?? 'ALL' }),
  loader: ({ deps }) => getPositions({ data: { account: deps.account, market: deps.market } }),
  component: Positions,
})

/** A heading over part of the table: an account, or a market. */
interface Heading {
  /** The name as text — also the section's accessible name. */
  label: string
  total: PositionTotal
  /** Set for an account, whose name is led by its colour dot. */
  accountType?: AccountType
}

/** One market's rows inside a section, under its own sub-heading. */
interface Part {
  /** Null where the section's heading already says everything. */
  head: Heading | null
  rows: PositionRow[]
}

interface Section {
  key: string
  /** Null when both filters are narrowed and a heading would only repeat them. */
  head: Heading | null
  parts: Part[]
}

const accountHeading = (total: PositionTotal, accountType: AccountType): Heading => ({
  label: ACCOUNT_TITLE[accountType] ?? accountType,
  total,
  accountType,
})

const marketHeading = (total: MarketTotal): Heading => ({
  label: MARKET_TITLE[total.market] ?? total.market,
  total,
})

/**
 * The sorted rows cut into the server's blocks, in the server's order — an
 * account with its markets as parts, or, when the account is not split, each
 * market a section of its own. Structure only: every total is the server's.
 */
function sectionsOf(data: PositionsData, sorted: PositionRow[]): Section[] {
  return data.groups.flatMap((group): Section[] => {
    const rows = sorted.filter((row) => inGroup(row, group))
    const byMarket = (total: MarketTotal): Part['rows'] => rows.filter((row) => inMarket(row, total.market))

    if (group.accountType != null) {
      return [
        {
          key: group.accountType,
          head: accountHeading(group, group.accountType),
          parts:
            group.markets.length > 0
              ? group.markets.map((total) => ({ head: marketHeading(total), rows: byMarket(total) }))
              : [{ head: null, rows }],
        },
      ]
    }
    return group.markets.length > 0
      ? group.markets.map((total) => ({
          key: total.market,
          head: marketHeading(total),
          parts: [{ head: null, rows: byMarket(total) }],
        }))
      : [{ key: 'all', head: null, parts: [{ head: null, rows }] }]
  })
}

/**
 * "No open US positions in NISA." — naming what the filters left out, so an
 * empty view is not read as an empty book.
 */
const emptyMessage = (account: AccountFilter, market: MarketFilter) => {
  const where = ACCOUNT_OPTIONS.find((option) => option.value === account)?.label
  return `No open ${market === 'ALL' ? '' : `${market} `}positions${account === 'ALL' ? '' : ` in ${where ?? account}`}.`
}

const positionsLabel = (count: number) => `${String(count)} position${count === 1 ? '' : 's'}`

/**
 * A heading row — an account's, or a market's within it — or the book's total
 * at the foot: the label across the columns with no total, then each shown
 * column's own total beneath it.
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
  /**
   * `rowgroup` for a section's heading, which labels the rows under it. A
   * market's sub-heading inside an account is `row`: one `tbody` has one group
   * heading, and the account is the one the rows belong to.
   */
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

/** A heading's name — an account's led by its dot — and its holding count. */
function HeadingName({ heading }: { heading: Heading }) {
  return (
    <span className={styles.groupName}>
      {heading.accountType ? <AccountDot accountType={heading.accountType} /> : null}
      {heading.label}
      <span className={styles.groupCount}>{positionsLabel(heading.total.count)}</span>
    </span>
  )
}

/** SP: a heading with its value and return beside it. */
function CardHeading({ heading, className }: { heading: Heading; className: string | undefined }) {
  return (
    <div className={className}>
      <HeadingName heading={heading} />
      <span className={styles.cardGroupFigures}>
        {yen(heading.total.marketValueJpy)}
        <span className={cx(styles.cardPct, toneClass(heading.total.unrealizedJpy))}>
          {pctSigned(heading.total.unrealizedPct)}
        </span>
      </span>
    </div>
  )
}

/** SP: a list of holdings. */
function PositionCards({ rows }: { rows: readonly PositionRow[] }) {
  return (
    <ul className={styles.cardList}>
      {rows.map((row) => (
        <PositionCard key={`${row.symbol}-${row.accountType}`} row={row} />
      ))}
    </ul>
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
  const { sortBy, sortDir, market = 'ALL' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [account, setAccount] = useAccountFilter()
  const isMobile = useIsMobile()
  const { data } = useQuery({
    queryKey: ['positions', account, market],
    queryFn: () => getPositions({ data: { account, market } }),
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

  // As `useAccountFilter` writes `scope`: `ALL` left out of the URL, `replace`
  // so Back leaves the screen, and no scroll to the top on a tap in the header.
  const setMarket = useCallback(
    (next: MarketFilter) => {
      void navigate({
        search: (prev) => ({ ...prev, market: next === 'ALL' ? undefined : next }),
        replace: true,
        resetScroll: false,
      })
    },
    [navigate],
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
  const sections = useMemo(() => sectionsOf(data, sorted), [data, sorted])

  // The file is the table as it reads — block by block, each in the chosen
  // order — so a spreadsheet opened beside the screen matches it.
  const exportFile = useCallback(
    () => ({
      filename: positionsCsvFilename(account, market),
      body: positionsCsv(
        sections.flatMap((section) => section.parts.flatMap((part) => part.rows)),
        { account: ACCOUNT_LABEL, assetClass: ASSET_LABEL },
      ),
    }),
    [sections, account, market],
  )

  // What the headings cut the table by, read off the blocks the server sent
  // rather than re-deciding it here from the filters.
  const splitBy = [
    data.groups.some((group) => group.accountType != null) ? 'account' : null,
    data.groups.some((group) => group.markets.length > 0) ? 'market' : null,
  ]
    .filter((part) => part != null)
    .join(' and ')

  // Remembered for the links back here, which otherwise drop the market: the
  // sidebar and the dashboard carry only the account switch, which every screen
  // shares.
  useEffect(() => {
    rememberMarket(market)
  }, [market])

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
        filter={
          <div className={styles.filters}>
            <AccountFilterControl value={account} onChange={setAccount} />
            <MarketFilterControl value={market} onChange={setMarket} />
          </div>
        }
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
        <Empty>{emptyMessage(account, market)}</Empty>
      ) : (
        <>
          <PositionsSummary data={data} compact={isMobile} />
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
              {sections.map((section) => (
                <section
                  key={section.key}
                  className={styles.cardGroup}
                  aria-label={section.head?.label ?? 'Positions'}
                >
                  {section.head ? <CardHeading heading={section.head} className={styles.cardGroupHead} /> : null}
                  {section.parts.map((part) =>
                    part.head ? (
                      <div
                        key={part.head.label}
                        role="group"
                        aria-label={`${section.head ? `${section.head.label}, ` : ''}${part.head.label}`}
                      >
                        <CardHeading heading={part.head} className={styles.cardSubHead} />
                        <PositionCards rows={part.rows} />
                      </div>
                    ) : (
                      <PositionCards key="rows" rows={part.rows} />
                    ),
                  )}
                </section>
              ))}
            </>
          ) : (
            <Table
              caption={`Positions${splitBy ? ` by ${splitBy}` : ''}, sorted by ${
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
              {sections.map((section) => (
                <tbody key={section.key} className={styles.group}>
                  {section.head ? (
                    <TotalRow
                      total={section.head.total}
                      label={<HeadingName heading={section.head} />}
                      scope="rowgroup"
                      leading={leading}
                      totalled={totalled}
                      className={styles.groupRow}
                    />
                  ) : null}
                  {section.parts.map((part) => (
                    <Fragment key={part.head?.label ?? 'rows'}>
                      {part.head ? (
                        <TotalRow
                          total={part.head.total}
                          label={<HeadingName heading={part.head} />}
                          scope="row"
                          leading={leading}
                          totalled={totalled}
                          className={styles.subgroupRow}
                        />
                      ) : null}
                      {part.rows.map((row) => (
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
                    </Fragment>
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
