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
import { ACCOUNT_LABEL, ASSET_LABEL, pct, qty, tone, yen, yenSigned } from '~/components/format'
import { InstrumentLink } from '~/components/InstrumentLink'
import { Empty, PageHeader, SortHeader, Stat, StatGrid, Table } from '~/components/screen'
import { AccountSwitch, useAccountFilter } from '~/components/ui/AccountSwitch'
import { POSITION_SORTABLE, positionSearchSchema, type PositionSortKey } from '~/lib/positionSearch'
import { nextSort, sortRows, type SortColumn } from '~/lib/sortRows'
import { getPositions, type PositionRow } from '~/server/screens'

/**
 * Label, alignment and sort value for each column, keyed by its sort key.
 *
 * One definition drives the header row, the ordering and the caption, so a
 * column cannot end up labelled one thing and sorted by another. Render order
 * comes from `POSITION_SORTABLE`.
 *
 * Every money field arrives as an exact decimal string, hence `numeric` on all
 * of them: compared as text, "9" would sort above "10".
 */
const COLUMNS: Record<PositionSortKey, SortColumn<PositionRow> & { label: string; numeric?: boolean }> = {
  symbol: { label: 'Instrument', value: (row) => row.symbol },
  accountType: {
    label: 'Account',
    // Sort by the label shown, not the raw enum, so the order matches the
    // column as read — 特定 and NISA 成長 do not collate like SPECIFIC and
    // NISA_GROWTH.
    value: (row) => ACCOUNT_LABEL[row.accountType] ?? row.accountType,
  },
  assetClass: { label: 'Class', value: (row) => ASSET_LABEL[row.assetClass] ?? row.assetClass },
  quantity: { label: 'Qty', numeric: true, value: (row) => row.quantity },
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
  },
  costBasisJpy: { label: 'Cost basis', numeric: true, value: (row) => row.costBasisJpy },
  price: { label: 'Price', numeric: true, value: (row) => row.currentPrice },
  marketValueJpy: { label: 'Value', numeric: true, value: (row) => row.marketValueJpy },
  unrealizedJpy: { label: 'Unrealized', numeric: true, value: (row) => row.unrealizedJpy },
  unrealizedPct: { label: '%', numeric: true, value: (row) => row.unrealizedPct },
}

export const Route = createFileRoute('/_authed/positions')({
  validateSearch: positionSearchSchema,
  // The account filter is a loader dependency, so changing it refetches rather
  // than re-rendering the previous account's figures. Sort is pointedly absent:
  // it reorders rows the client already has.
  loaderDeps: ({ search }) => ({ account: search.scope ?? 'ALL' }),
  loader: ({ deps }) => getPositions({ data: { account: deps.account } }),
  component: Positions,
})

function Positions() {
  const initial = Route.useLoaderData()
  const { sortBy, sortDir } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [account, setAccount] = useAccountFilter()
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

  const sorted = useMemo(() => sortRows(rows, COLUMNS, sortBy, sortDir), [rows, sortBy, sortDir])

  // TODO(nit): these totals reconstruct floats from the exact decimal strings
  // the server deliberately sent as strings, which is the one place the UI does
  // financial arithmetic — the thing `components/format.ts` and the server-side
  // formatting exist to prevent. Safe in practice: these are whole yen, and the
  // portfolio would need to reach ~9×10¹⁵ before a float lost integer precision.
  // Fix: return the three totals from `getPositions` already summed and
  // formatted, so the client only renders them.
  const totalCost = rows.reduce((running, row) => running + Number(row.costBasisJpy), 0)
  const priced = rows.filter((row) => row.marketValueJpy != null)
  const totalValue = priced.reduce((running, row) => running + Number(row.marketValueJpy), 0)
  const totalUnrealized = priced.reduce((running, row) => running + Number(row.unrealizedJpy), 0)
  const unpriced = rows.length - priced.length

  return (
    <>
      <PageHeader
        title="Positions"
        meta={`${String(rows.length)} open · ${yen(totalCost)} cost basis`}
      >
        <AccountSwitch value={account} onChange={setAccount} />
      </PageHeader>

      <StatGrid>
        <Stat label="Open positions" value={rows.length} />
        <Stat label="Cost basis" value={yen(totalCost)} />
        <Stat
          label="Market value"
          value={priced.length ? yen(totalValue) : '—'}
          hint={unpriced > 0 ? `${String(unpriced)} without a price` : undefined}
        />
        <Stat
          label="Unrealized"
          value={priced.length ? yenSigned(totalUnrealized) : '—'}
          tone={tone(totalUnrealized)}
          hint={priced.length ? `across ${String(priced.length)} priced` : undefined}
        />
      </StatGrid>

      {unpriced > 0 ? (
        <p className={styles.note}>
          {unpriced} position{unpriced === 1 ? '' : 's'} have no cached price, so no valuation is
          shown for them. Prices are fetched on visit for US tickers; JP equities and funds need a
          manual entry in Settings. Sorting by a priced column leaves them at the bottom either way.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <Empty>No open positions.</Empty>
      ) : (
        <Table
          caption={`Positions, sorted by ${COLUMNS[sortBy].label} ${
            sortDir === 'asc' ? 'ascending' : 'descending'
          }`}
        >
          <thead>
            <tr>
              {POSITION_SORTABLE.map((key) => (
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
                <td>
                  <InstrumentLink symbol={row.symbol} name={row.name} assetClass={row.assetClass} />
                </td>
                <td>{ACCOUNT_LABEL[row.accountType] ?? row.accountType}</td>
                <td>{ASSET_LABEL[row.assetClass]}</td>
                <td data-numeric>{qty(row.quantity)}</td>
                <td data-numeric>
                  {row.currency === 'USD' ? `$${Number(row.avgPriceNative).toFixed(2)}` : yen(row.avgCostPerUnit)}
                </td>
                <td data-numeric>{yen(row.costBasisJpy)}</td>
                <td data-numeric>
                  {row.currentPrice == null
                    ? '—'
                    : row.currency === 'USD'
                      ? `$${Number(row.currentPrice).toFixed(2)}`
                      : yen(row.currentPrice)}
                </td>
                <td data-numeric>{yen(row.marketValueJpy)}</td>
                <td data-numeric className={tone(row.unrealizedJpy)}>
                  {row.unrealizedJpy == null ? '—' : yenSigned(row.unrealizedJpy)}
                </td>
                <td data-numeric className={tone(row.unrealizedJpy)}>
                  {pct(row.unrealizedPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  )
}
