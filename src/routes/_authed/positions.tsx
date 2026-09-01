/**
 * Open positions.
 *
 * Sorting is client-side over rows already in memory: the account filter is a
 * loader dependency and sorting deliberately is not, so clicking a header
 * reorders instantly rather than making a round trip for the same rows back in
 * a different order.
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import styles from './positions.module.scss'
import { AccountDot } from '~/components/AccountDot'
import { ZeroBar } from '~/components/charts/ZeroBar'
import { ACCOUNT_LABEL, ASSET_LABEL, pct, qty, tone, yen, yenSigned } from '~/components/format'
import { InstrumentLink } from '~/components/InstrumentLink'
import { Empty, HeroStat, PageHeader, SegmentedTabs, SortHeader, StatStrip, StripCell, Table } from '~/components/screen'
import { AccountFilterControl } from '~/components/ui/AccountFilterControl'
import { useAccountFilter } from '~/components/ui/AccountSwitch'
import { ColumnMenu } from '~/components/ui/ColumnMenu'
import { ExportButton } from '~/components/ui/ExportButton'
import { useColumnVisibility } from '~/components/ui/useColumnVisibility'
import { useIsMobile } from '~/components/ui/useIsMobile'
import { cx } from '~/lib/cx'
import { positionsCsv, positionsCsvFilename } from '~/lib/export/positionsCsv'
import { POSITION_SORTABLE, positionSearchSchema, type PositionSortKey } from '~/lib/positionSearch'
import { nextSort, sortRows, type SortColumn } from '~/lib/sortRows'
import type { TableColumn } from '~/lib/table/columns'
import { getPositions, type PositionRow } from '~/server/screens'

/**
 * What a cell needs beyond its own row.
 *
 * Only the unrealized bar uses it, but it goes through the same `cell`
 * signature as everything else: a column that renders itself is worth more
 * than one the table body has to special-case, because the special case is
 * what leaves the column's own `cell` sitting there unreachable.
 */
interface CellContext {
  /** Largest gain and loss across every row, so all bars share one scale. */
  maxPos: number
  maxNeg: number
}

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
  cell: (row: PositionRow, context: CellContext) => React.ReactNode
  /** Profit/loss tint, for the columns that carry one. */
  tone?: (row: PositionRow) => string | undefined
}

const ACCOUNT_COLOR: Record<string, string> = {
  SPECIFIC: 'var(--color-specific)',
  NISA_GROWTH: 'var(--color-nisa-growth)',
  NISA_TSUMITATE: 'var(--color-nisa-tsumitate)',
  NISA_OLD: 'var(--color-nisa-old)',
}

const signedPct = (value: number) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`

/**
 * Label, alignment, sort value and cell for each column, keyed by its sort key.
 *
 * One definition drives the header row, the body, the ordering and the caption,
 * all rendered in `POSITION_SORTABLE` order — so a column cannot end up
 * labelled one thing and sorted by another, and reordering the list moves the
 * header and its figures together rather than sliding them out of step.
 *
 * Every money field arrives as an exact decimal string, hence `numeric` on all
 * of them: compared as text, "9" would sort above "10".
 */
const COLUMNS: Record<PositionSortKey, PositionColumn> = {
  symbol: {
    label: 'Instrument',
    locked: true,
    value: (row) => row.symbol,
    cell: (row) => <InstrumentLink symbol={row.symbol} name={row.name} assetClass={row.assetClass} />,
  },
  accountType: {
    label: 'Account',
    // Sort by the label shown, not the raw enum, so the order matches the
    // column as read — 特定 and NISA 成長 do not collate like SPECIFIC and
    // NISA_GROWTH.
    value: (row) => ACCOUNT_LABEL[row.accountType] ?? row.accountType,
    cell: (row) => (
      <span className={styles.accountCell}>
        <AccountDot accountType={row.accountType} />
        {ACCOUNT_LABEL[row.accountType] ?? row.accountType}
      </span>
    ),
  },
  assetClass: {
    label: 'Class',
    value: (row) => ASSET_LABEL[row.assetClass] ?? row.assetClass,
    cell: (row) => ASSET_LABEL[row.assetClass] ?? row.assetClass,
  },
  quantity: {
    label: 'Qty',
    numeric: true,
    locked: true,
    value: (row) => row.quantity,
    cell: (row) => qty(row.quantity),
  },
  /*
   * Avg cost and Price render the native figure — $150 sits in the same column
   * as ¥3,000 — and sort on exactly that. The alternative, sorting a USD row by
   * a hidden JPY equivalent, would order the table by numbers it does not show.
   * So USD and JPY rows interleave by raw magnitude; the JPY columns beside
   * them (Cost basis, Value, Unrealized) are the ones that compare across the
   * whole book.
   */
  avgCost: {
    label: 'Avg cost',
    numeric: true,
    value: (row) => (row.currency === 'USD' ? row.avgPriceNative : row.avgCostPerUnit),
    cell: (row) =>
      row.currency === 'USD' ? `$${Number(row.avgPriceNative).toFixed(2)}` : yen(row.avgCostPerUnit),
  },
  costBasisJpy: {
    label: 'Cost basis',
    numeric: true,
    value: (row) => row.costBasisJpy,
    cell: (row) => yen(row.costBasisJpy),
  },
  price: {
    label: 'Price',
    numeric: true,
    locked: true,
    value: (row) => row.currentPrice,
    cell: (row) =>
      row.currentPrice == null
        ? '—'
        : row.currency === 'USD'
          ? `$${Number(row.currentPrice).toFixed(2)}`
          : yen(row.currentPrice),
  },
  marketValueJpy: {
    label: 'Value',
    numeric: true,
    value: (row) => row.marketValueJpy,
    cell: (row) => yen(row.marketValueJpy),
  },
  // The bar is measured off a zero line, so it needs the whole table's extents
  // rather than just this row — hence the context argument.
  unrealizedJpy: {
    label: 'Unrealized',
    numeric: true,
    value: (row) => row.unrealizedJpy,
    cell: (row, context) => <UnrealizedCell row={row} maxPos={context.maxPos} maxNeg={context.maxNeg} />,
  },
  unrealizedPct: {
    label: '%',
    numeric: true,
    value: (row) => row.unrealizedPct,
    cell: (row) => pct(row.unrealizedPct),
    // Tinted off the yen figure, not the percentage, so the two cells always
    // agree — `pct` shows a dash where `unrealizedPct` is null.
    tone: (row) => tone(row.unrealizedJpy),
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

/** The zero-origin bar and the signed figure it measures, in one cell. */
function UnrealizedCell({
  row,
  maxPos,
  maxNeg,
}: {
  row: PositionRow
  maxPos: number
  maxNeg: number
}) {
  if (row.unrealizedJpy == null) return <span className={styles.dim}>—</span>

  const value = Number(row.unrealizedJpy)
  const rowTone = tone(value)

  return (
    <div className={styles.unrealCell}>
      <div className={styles.unrealTrack}>
        <ZeroBar value={value} maxPos={maxPos} maxNeg={maxNeg} size="compact" />
      </div>
      <span
        className={cx(styles.unrealValue, rowTone === 'profit' && styles.profit, rowTone === 'loss' && styles.loss)}
      >
        {yenSigned(value)}
      </span>
    </div>
  )
}

/** Segmented allocation-by-account bar, with a legend on PC. */
function AllocationBar({
  segments,
}: {
  segments: { label: string; value: string; pct: number; color: string }[]
}) {
  if (segments.length === 0) return null

  return (
    <div className={styles.allocation}>
      <div className={styles.allocationTrack}>
        {segments.map((segment) => (
          <span
            key={segment.label}
            className={styles.allocationSegment}
            style={{ width: `${String(segment.pct * 100)}%`, backgroundColor: segment.color }}
          />
        ))}
      </div>
      <div className={styles.allocationLegend}>
        {segments.map((segment) => (
          <span key={segment.label} className={styles.allocationItem}>
            <span className={styles.allocationSwatch} style={{ backgroundColor: segment.color }} />
            {segment.label}
            <span className={styles.allocationValue}>{segment.value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** SP replacement for a table row — a card with the same figures, no sideways scroll. */
function PositionCard({
  row,
  maxPos,
  maxNeg,
}: {
  row: PositionRow
  maxPos: number
  maxNeg: number
}) {
  const priceLabel =
    row.currentPrice == null
      ? '—'
      : row.currency === 'USD'
        ? `$${Number(row.currentPrice).toFixed(2)}`
        : yen(row.currentPrice)
  const unrealValue = row.unrealizedJpy == null ? null : Number(row.unrealizedJpy)
  const unrealTone = unrealValue == null ? 'flat' : tone(unrealValue)

  return (
    <div className={styles.card}>
      <div className={styles.cardRow}>
        <span className={styles.cardSymbol}>{row.symbol}</span>
        <span className={styles.cardValue}>{row.marketValueJpy == null ? '—' : yen(row.marketValueJpy)}</span>
      </div>
      <div className={styles.cardRow}>
        <span className={styles.cardMeta}>
          <AccountDot accountType={row.accountType} />
          <span className={styles.cardMetaText}>
            {ACCOUNT_LABEL[row.accountType] ?? row.accountType} · {qty(row.quantity)} @ {priceLabel}
          </span>
        </span>
        <span
          className={cx(styles.cardUnreal, unrealTone === 'profit' && styles.profit, unrealTone === 'loss' && styles.loss)}
        >
          {unrealValue == null ? '—' : yenSigned(unrealValue)}{' '}
          <span className={styles.cardDim}>{pct(row.unrealizedPct)}</span>
        </span>
      </div>
      {unrealValue != null ? (
        <div className={styles.cardTrack}>
          <ZeroBar value={unrealValue} maxPos={maxPos} maxNeg={maxNeg} />
        </div>
      ) : null}
    </div>
  )
}

function Positions() {
  const initial = Route.useLoaderData()
  const { sortBy, sortDir } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [account, setAccount] = useAccountFilter()
  const isMobile = useIsMobile()
  const { data: rows } = useQuery({
    queryKey: ['positions', account],
    queryFn: () => getPositions({ data: { account } }),
    initialData: initial,
  })

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

  /*
   * `scope=SPECIFIC` narrows to the one taxable account, so the Account column
   * reads 特定 on every row and says nothing.
   *
   * `scope=NISA` deliberately does not: it keeps three frames — 旧NISA, 成長投資枠
   * and つみたて投資枠 — and which one a row sits in is exactly the distinction
   * that matters there.
   */
  const redundant = useMemo(() => (account === 'SPECIFIC' ? ['accountType'] : []), [account])

  const columns = useColumnVisibility('positions', PICKER, redundant)
  // The rendered order stays `POSITION_SORTABLE`'s, filtered — so re-showing a
  // column puts it back where it was rather than appending it.
  const shown = useMemo(
    () => POSITION_SORTABLE.filter((key) => columns.visible.has(key)),
    [columns.visible],
  )

  const sorted = useMemo(() => sortRows(rows, COLUMNS, sortBy, sortDir), [rows, sortBy, sortDir])

  // Exports `sorted`, not `rows` — the file is the table as it stands, account
  // filter and sort column included, so a spreadsheet opened beside the screen
  // is not in a different order.
  const exportFile = useCallback(
    () => ({
      filename: positionsCsvFilename(account),
      body: positionsCsv(sorted, { account: ACCOUNT_LABEL, assetClass: ASSET_LABEL }),
    }),
    [sorted, account],
  )

  // TODO(nit): these totals reconstruct floats from the exact decimal strings
  // the server deliberately sent as strings, which is the one place the UI does
  // financial arithmetic — the thing `components/format.ts` and the server-side
  // formatting exist to prevent. Safe in practice: these are whole yen, and the
  // portfolio would need to reach ~9×10¹⁵ before a float lost integer precision.
  // Fix: return the three totals from `getPositions` already summed and
  // formatted, so the client only renders them.
  /*
   * Everything the chrome above the table reads, derived in one pass.
   *
   * One memo rather than several: the intermediate `priced` list feeds the
   * totals, the allocation and the highlights alike, so splitting them would
   * either recompute it three times or leave it out of the dependency arrays
   * of the memos that use it — which is how a memo goes quietly stale.
   */
  const summary = useMemo(() => {
    const priced = rows.filter((row) => row.marketValueJpy != null)
    const totalCost = rows.reduce((running, row) => running + Number(row.costBasisJpy), 0)
    const totalValue = priced.reduce((running, row) => running + Number(row.marketValueJpy), 0)
    const totalUnrealized = priced.reduce((running, row) => running + Number(row.unrealizedJpy), 0)

    const byAccount = new Map<string, number>()
    for (const row of priced) {
      byAccount.set(row.accountType, (byAccount.get(row.accountType) ?? 0) + Number(row.marketValueJpy))
    }

    // The bar scale spans every row, sorted or not, so re-sorting the table
    // never rescales the bars underneath it.
    const unrealizedValues = rows.map((row) =>
      row.unrealizedJpy == null ? 0 : Number(row.unrealizedJpy),
    )

    return {
      priced,
      totalCost,
      totalValue,
      totalUnrealized,
      unpriced: rows.length - priced.length,
      unrealizedPctOfCost: totalCost > 0 ? totalUnrealized / totalCost : null,
      barScale: {
        maxPos: Math.max(0, ...unrealizedValues),
        maxNeg: Math.abs(Math.min(0, ...unrealizedValues)),
      },
      allocation: [...byAccount.entries()]
        .sort(([, left], [, right]) => right - left)
        .map(([accountType, value]) => ({
          label: ACCOUNT_LABEL[accountType] ?? accountType,
          value: yen(value),
          pct: totalValue > 0 ? value / totalValue : 0,
          color: ACCOUNT_COLOR[accountType] ?? 'var(--color-text-subtle)',
        })),
      highlights:
        priced.length === 0
          ? null
          : {
              largest: priced.reduce((max, row) =>
                Number(row.marketValueJpy) > Number(max.marketValueJpy) ? row : max,
              ),
              best: priced.reduce((max, row) =>
                (row.unrealizedPct ?? -Infinity) > (max.unrealizedPct ?? -Infinity) ? row : max,
              ),
              worst: priced.reduce((min, row) =>
                (row.unrealizedPct ?? Infinity) < (min.unrealizedPct ?? Infinity) ? row : min,
              ),
            },
    }
  }, [rows])

  const { priced, totalCost, totalValue, totalUnrealized, unpriced, unrealizedPctOfCost, barScale, allocation, highlights } =
    summary

  return (
    <>
      <PageHeader title="Positions" meta={`${String(rows.length)} open · ${yen(totalCost)} cost basis`}>
        <AccountFilterControl value={account} onChange={setAccount} />
        <ExportButton file={exportFile} disabled={rows.length === 0}>
          Export CSV
        </ExportButton>
        {isMobile ? null : (
          <ColumnMenu
            columns={PICKER}
            hidden={columns.hidden}
            redundant={redundant}
            hiddenCount={columns.hiddenCount}
            onToggle={columns.toggle}
            onReset={columns.reset}
          />
        )}
      </PageHeader>

      <div className={styles.heroRow}>
        <HeroStat label="Market value" value={priced.length ? yen(totalValue) : '—'}>
          {priced.length ? (
            <span className={cx(styles.heroContext, tone(totalUnrealized) === 'profit' && styles.profit, tone(totalUnrealized) === 'loss' && styles.loss)}>
              {yenSigned(totalUnrealized)} unrealized
              {unrealizedPctOfCost != null ? ` · ${signedPct(unrealizedPctOfCost)}` : ''}
            </span>
          ) : null}
          {isMobile ? <AllocationBar segments={allocation} /> : null}
        </HeroStat>
        <StatStrip>
          <StripCell label="Open positions" value={rows.length} />
          <StripCell label="Cost basis" value={yen(totalCost)} />
          <StripCell
            label="Largest holding"
            value={
              highlights
                ? `${highlights.largest.symbol} · ${pct(totalValue > 0 ? Number(highlights.largest.marketValueJpy) / totalValue : 0)}`
                : '—'
            }
          />
          <StripCell
            label="Best"
            value={highlights?.best.unrealizedPct != null ? `${highlights.best.symbol} ${signedPct(highlights.best.unrealizedPct)}` : '—'}
            tone="profit"
          />
          <StripCell
            label="Worst"
            value={highlights?.worst.unrealizedPct != null ? `${highlights.worst.symbol} ${signedPct(highlights.worst.unrealizedPct)}` : '—'}
            tone="loss"
          />
        </StatStrip>
      </div>

      {isMobile ? null : <AllocationBar segments={allocation} />}

      {unpriced > 0 ? (
        <p className={styles.note}>
          {unpriced} position{unpriced === 1 ? '' : 's'} have no cached price, so no valuation is
          shown for them. Prices are fetched on visit for US tickers; JP equities and funds need a
          manual entry in Settings. Sorting by a priced column leaves them at the bottom either way.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <Empty>No open positions.</Empty>
      ) : isMobile ? (
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
          <div className={styles.cardList}>
            {sorted.map((row) => (
              <PositionCard
                key={`${row.symbol}-${row.accountType}`}
                row={row}
                maxPos={barScale.maxPos}
                maxNeg={barScale.maxNeg}
              />
            ))}
          </div>
        </>
      ) : (
        <Table
          caption={`Positions, sorted by ${COLUMNS[sortBy].label} ${
            sortDir === 'asc' ? 'ascending' : 'descending'
          }`}
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
          <tbody>
            {sorted.map((row) => (
              <tr key={`${row.symbol}-${row.accountType}`}>
                {shown.map((key) => {
                  const column = COLUMNS[key]
                  return (
                    <td key={key} data-numeric={column.numeric ? '' : undefined} className={column.tone?.(row)}>
                      {column.cell(row, barScale)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  )
}
