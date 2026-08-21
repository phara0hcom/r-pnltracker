import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import styles from './positions.module.scss'
import { ACCOUNT_LABEL, ASSET_LABEL, pct, qty, tone, yen, yenSigned } from '~/components/format'
import { InstrumentLink } from '~/components/InstrumentLink'
import { Empty, PageHeader, Stat, StatGrid, Table } from '~/components/screen'
import { AccountSwitch, useAccountFilter } from '~/components/ui/AccountSwitch'
import { accountScopeSchema } from '~/lib/accountScope'
import { getPositions } from '~/server/screens'

export const Route = createFileRoute('/_authed/positions')({
  validateSearch: accountScopeSchema,
  // The filter is a loader dependency, so changing it refetches rather than
  // re-rendering the previous account's figures.
  loaderDeps: ({ search }) => ({ account: search.scope ?? 'ALL' }),
  loader: ({ deps }) => getPositions({ data: { account: deps.account } }),
  component: Positions,
})

function Positions() {
  const initial = Route.useLoaderData()
  const [account, setAccount] = useAccountFilter()
  const { data: rows } = useQuery({
    queryKey: ['positions', account],
    queryFn: () => getPositions({ data: { account } }),
    initialData: initial,
  })

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
          manual entry in Settings.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <Empty>No open positions.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th scope="col">Instrument</th>
              <th scope="col">Account</th>
              <th scope="col">Class</th>
              <th scope="col" data-numeric>Qty</th>
              <th scope="col" data-numeric>Avg cost</th>
              <th scope="col" data-numeric>Cost basis</th>
              <th scope="col" data-numeric>Price</th>
              <th scope="col" data-numeric>Value</th>
              <th scope="col" data-numeric>Unrealized</th>
              <th scope="col" data-numeric>%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
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
