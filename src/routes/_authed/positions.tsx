import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import styles from './positions.module.scss'
import { ACCOUNT_LABEL, ASSET_LABEL, pct, qty, tone, yen, yenSigned } from '~/components/format'
import { InstrumentLink } from '~/components/InstrumentLink'
import { Empty, PageHeader, Stat, StatGrid, Table } from '~/components/Screen'
import { getPositions } from '~/server/screens'

export const Route = createFileRoute('/_authed/positions')({
  loader: () => getPositions(),
  component: Positions,
})

function Positions() {
  const initial = Route.useLoaderData()
  const { data: rows } = useQuery({
    queryKey: ['positions'],
    queryFn: () => getPositions(),
    initialData: initial,
  })

  const totalCost = rows.reduce((a, r) => a + Number(r.costBasisJpy), 0)
  const priced = rows.filter((r) => r.marketValueJpy != null)
  const totalValue = priced.reduce((a, r) => a + Number(r.marketValueJpy), 0)
  const totalUnrealized = priced.reduce((a, r) => a + Number(r.unrealizedJpy), 0)
  const unpriced = rows.length - priced.length

  return (
    <>
      <PageHeader
        title="Positions"
        meta={`${String(rows.length)} open · ${yen(totalCost)} cost basis`}
      />

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
            {rows.map((r) => (
              <tr key={`${r.symbol}-${r.accountType}`}>
                <td>
                  <InstrumentLink symbol={r.symbol} name={r.name} assetClass={r.assetClass} />
                </td>
                <td>{ACCOUNT_LABEL[r.accountType] ?? r.accountType}</td>
                <td>{ASSET_LABEL[r.assetClass]}</td>
                <td data-numeric>{qty(r.quantity)}</td>
                <td data-numeric>
                  {r.currency === 'USD' ? `$${Number(r.avgPriceNative).toFixed(2)}` : yen(r.avgCostPerUnit)}
                </td>
                <td data-numeric>{yen(r.costBasisJpy)}</td>
                <td data-numeric>
                  {r.currentPrice == null
                    ? '—'
                    : r.currency === 'USD'
                      ? `$${Number(r.currentPrice).toFixed(2)}`
                      : yen(r.currentPrice)}
                </td>
                <td data-numeric>{yen(r.marketValueJpy)}</td>
                <td data-numeric className={tone(r.unrealizedJpy)}>
                  {r.unrealizedJpy == null ? '—' : yenSigned(r.unrealizedJpy)}
                </td>
                <td data-numeric className={tone(r.unrealizedJpy)}>
                  {pct(r.unrealizedPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  )
}
