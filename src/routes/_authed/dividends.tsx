import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import styles from './dividends.module.scss'
import { ACCOUNT_LABEL, qty, yen } from '~/components/format'
import { InstrumentLink } from '~/components/InstrumentLink'
import { Empty, PageHeader, Section, Stat, StatGrid, Table } from '~/components/Screen'
import { AccountSwitch, useAccountFilter } from '~/components/ui/AccountSwitch'
import { accountScopeSchema } from '~/lib/accountScope'
import { getDividends } from '~/server/screens'

export const Route = createFileRoute('/_authed/dividends')({
  validateSearch: accountScopeSchema,
  loaderDeps: ({ search }) => ({ account: search.scope ?? 'ALL' }),
  loader: ({ deps }) => getDividends({ data: { account: deps.account } }),
  component: Dividends,
})

const KIND_LABEL: Record<string, string> = {
  DIVIDEND: '配当金',
  DISTRIBUTION: '分配金',
}

function Dividends() {
  const initial = Route.useLoaderData()
  const [account, setAccount] = useAccountFilter()
  const { data } = useQuery({
    queryKey: ['dividends', account],
    queryFn: () => getDividends({ data: { account } }),
    initialData: initial,
  })

  const { totals, usHoldings: us } = data
  const taxFreeShare =
    Number(totals.gross) > 0 ? Number(totals.taxFreeGross) / Number(totals.gross) : null

  return (
    <>
      <PageHeader
        title="Dividends"
        meta={`${String(totals.count)} payment${totals.count === 1 ? '' : 's'} · ${yen(totals.gross)} gross`}
      >
        <AccountSwitch value={account} onChange={setAccount} />
      </PageHeader>

      <StatGrid>
        <Stat label="Gross received" value={yen(totals.gross)} />
        <Stat
          label="Withheld"
          value={yen(totals.tax)}
          hint={Number(totals.tax) === 0 ? 'nothing withheld' : '20.315% on 特定 only'}
        />
        <Stat label="Net received" value={yen(totals.net)} tone="profit" />
        <Stat
          label="Tax-free"
          value={taxFreeShare == null ? '—' : `${(taxFreeShare * 100).toFixed(0)}%`}
          hint={`${yen(totals.taxFreeGross)} paid into NISA`}
        />
      </StatGrid>

      {data.rows.length === 0 ? (
        <Empty>
          No dividends recorded. They come from 取引残高報告書 statements — the trade history
          exports do not contain them.
        </Empty>
      ) : (
        <>
          <Section
            title="By year"
            description="Dated on the payment date, which is when the cash and any withholding actually land."
          >
            <Table>
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col" data-numeric>Payments</th>
                  <th scope="col" data-numeric>Gross</th>
                  <th scope="col" data-numeric>Withheld</th>
                  <th scope="col" data-numeric>Net</th>
                </tr>
              </thead>
              <tbody>
                {data.byYear.map((y) => (
                  <tr key={y.year}>
                    <td>{y.year}</td>
                    <td data-numeric>{y.count}</td>
                    <td data-numeric>{yen(y.gross)}</td>
                    <td data-numeric className={styles.dim}>{yen(y.tax)}</td>
                    <td data-numeric className={styles.profit}>{yen(y.net)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>

          <Section title="By instrument">
            <Table>
              <thead>
                <tr>
                  <th scope="col">Instrument</th>
                  <th scope="col" data-numeric>Payments</th>
                  <th scope="col" data-numeric>Gross</th>
                  <th scope="col" data-numeric>Net</th>
                  <th scope="col">Last paid</th>
                </tr>
              </thead>
              <tbody>
                {data.bySymbol.map((s) => (
                  <tr key={s.symbol}>
                    <td>
                      <InstrumentLink symbol={s.symbol} name={s.name} assetClass={s.assetClass} />
                    </td>
                    <td data-numeric>{s.count}</td>
                    <td data-numeric>{yen(s.gross)}</td>
                    <td data-numeric className={styles.profit}>{yen(s.net)}</td>
                    <td className={styles.dim}>{s.lastPaid}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>

          <Section
            title="All payments"
            description="Gross is reconstructed from the credited amount — Rakuten's statement reports only what it paid out, never the pre-tax figure."
          >
            <Table>
              <thead>
                <tr>
                  <th scope="col">Paid</th>
                  <th scope="col">Instrument</th>
                  <th scope="col">Account</th>
                  <th scope="col">Type</th>
                  <th scope="col" data-numeric>Gross</th>
                  <th scope="col" data-numeric>Income tax</th>
                  <th scope="col" data-numeric>Local tax</th>
                  <th scope="col" data-numeric>Net</th>
                  <th scope="col">Reinvested</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.payDate}-${r.symbol}-${r.accountType}-${r.netAmount}`}>
                    <td>{r.payDate}</td>
                    <td>
                      <InstrumentLink symbol={r.symbol} name={r.name} assetClass={r.assetClass} />
                    </td>
                    <td>
                      {ACCOUNT_LABEL[r.accountType] ?? r.accountType}
                      {r.confident ? null : (
                        <span
                          className={styles.inferred}
                          title="The paying account was inferred: the statement's cash ledger has no account column, and the position had already closed when this was paid."
                        >
                          inferred
                        </span>
                      )}
                    </td>
                    <td className={styles.dim}>{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td data-numeric>{yen(r.grossAmount)}</td>
                    <td data-numeric className={styles.dim}>
                      {Number(r.incomeTax) === 0 ? '—' : yen(r.incomeTax)}
                    </td>
                    <td data-numeric className={styles.dim}>
                      {Number(r.localTax) === 0 ? '—' : yen(r.localTax)}
                    </td>
                    <td data-numeric className={styles.profit}>{yen(r.netAmount)}</td>
                    <td className={styles.dim}>
                      {r.reinvestedJpy == null ? (
                        '—'
                      ) : (
                        <span title="This distribution was rolled straight back into units, so it is income and an increase in cost basis at the same time.">
                          {qty(r.reinvestedUnits ?? '0')} 口
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>
        </>
      )}

      {data.hasInferred ? (
        <p className={styles.note}>
          Rows marked <strong>inferred</strong> had their account guessed. The cash ledger names no
          account, so attribution matches the payment against holdings — which fails when the
          position was already sold by the pay date. It affects which bucket the income is reported
          in, not the amount.
        </p>
      ) : null}

      {us.tickerCount > 0 ? (
        <p className={styles.gap}>
          <strong>No US dividend income is recorded</strong>, across {us.tickerCount} US tickers.
          Most likely there was none to record: {us.shortHoldCount} of {us.tickerCount} were held
          under a month, which rarely spans a quarterly record date — you have to hold through the
          ex-dividend date to be paid at all.
          {us.quarterSpanning.length > 0 ? (
            <>
              {' '}
              The exceptions are{' '}
              {us.quarterSpanning.map((q, i) => (
                <span key={q.symbol}>
                  {i > 0 ? (i === us.quarterSpanning.length - 1 ? ' and ' : ', ') : ''}
                  <strong>{q.symbol}</strong> ({q.days}d)
                </span>
              ))}
              , held long enough to cross one.
            </>
          ) : null}{' '}
          Worth knowing either way: Rakuten publishes foreign dividends only in a separate
          外国株式配当金計算書, which is in neither the trade history nor the 取引残高報告書 — so
          this screen could not show a US payment even if one had been made.
        </p>
      ) : null}
    </>
  )
}
