import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import styles from './dividends.module.scss'
import { ACCOUNT_LABEL, qty, yen } from '~/components/format'
import { InstrumentLink } from '~/components/InstrumentLink'
import { Empty, PageHeader, Section, Stat, StatGrid, Table } from '~/components/screen'
import { AccountFilterControl } from '~/components/ui/AccountFilterControl'
import { useAccountFilter } from '~/components/ui/AccountSwitch'
import { ColumnMenu } from '~/components/ui/ColumnMenu'
import { useColumnVisibility } from '~/components/ui/useColumnVisibility'
import { accountScopeSchema } from '~/lib/accountScope'
import type { TableColumn } from '~/lib/table/columns'
import { getDividends, type DividendRow } from '~/server/screens'

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

/**
 * The "All payments" table, one definition per column.
 *
 * Header, cell and the ⋯ picker all read from here, so a column cannot end up
 * labelled one thing in the menu and another in the table.
 *
 * Three are locked: the instrument names the row, the pay date places it, and
 * net is the figure that actually reached the account — with all four money
 * columns hidden a payment row would say nothing at all.
 */
interface PayoutColumn extends TableColumn<PayoutKey> {
  numeric?: boolean
  cell: (row: DividendRow, styles: Record<string, string | undefined>) => React.ReactNode
  className?: string
}

type PayoutKey =
  | 'payDate'
  | 'instrument'
  | 'account'
  | 'kind'
  | 'gross'
  | 'incomeTax'
  | 'localTax'
  | 'net'
  | 'reinvested'

const PAYOUT_COLUMNS: PayoutColumn[] = [
  { key: 'payDate', label: 'Paid', locked: true, cell: (row) => row.payDate },
  {
    key: 'instrument',
    label: 'Instrument',
    locked: true,
    cell: (row) => (
      <InstrumentLink symbol={row.symbol} name={row.name} assetClass={row.assetClass} />
    ),
  },
  {
    key: 'account',
    label: 'Account',
    cell: (row, css) => (
      <>
        {ACCOUNT_LABEL[row.accountType] ?? row.accountType}
        {row.confident ? null : (
          <span
            className={css.inferred}
            title="The paying account was inferred: the statement's cash ledger has no account column, and the position had already closed when this was paid."
          >
            inferred
          </span>
        )}
      </>
    ),
  },
  { key: 'kind', label: 'Type', className: 'dim', cell: (row) => KIND_LABEL[row.kind] ?? row.kind },
  { key: 'gross', label: 'Gross', numeric: true, cell: (row) => yen(row.grossAmount) },
  {
    key: 'incomeTax',
    label: 'Income tax',
    numeric: true,
    className: 'dim',
    cell: (row) => (Number(row.incomeTax) === 0 ? '—' : yen(row.incomeTax)),
  },
  {
    key: 'localTax',
    label: 'Local tax',
    numeric: true,
    className: 'dim',
    cell: (row) => (Number(row.localTax) === 0 ? '—' : yen(row.localTax)),
  },
  {
    key: 'net',
    label: 'Net',
    numeric: true,
    locked: true,
    className: 'profit',
    cell: (row) => yen(row.netAmount),
  },
  {
    key: 'reinvested',
    label: 'Reinvested',
    className: 'dim',
    cell: (row) =>
      row.reinvestedJpy == null ? (
        '—'
      ) : (
        <span title="This distribution was rolled straight back into units, so it is income and an increase in cost basis at the same time.">
          {qty(row.reinvestedUnits ?? '0')} 口
        </span>
      ),
  },
]

function Dividends() {
  const initial = Route.useLoaderData()
  const [account, setAccount] = useAccountFilter()
  const { data } = useQuery({
    queryKey: ['dividends', account],
    queryFn: () => getDividends({ data: { account } }),
    initialData: initial,
  })

  /*
   * `scope=SPECIFIC` narrows to the one taxable account, so the Account column
   * reads 特定 on every row and says nothing.
   *
   * `scope=NISA` deliberately does not: it keeps three frames — 旧NISA, 成長投資枠
   * and つみたて投資枠 — and which one a row sits in is exactly the distinction
   * that matters there.
   */
  const redundant = useMemo(() => (account === 'SPECIFIC' ? ['account'] : []), [account])

  const columns = useColumnVisibility('dividends', PAYOUT_COLUMNS, redundant)
  // Declaration order, filtered — so re-showing a column returns it to its place.
  const shown = PAYOUT_COLUMNS.filter((column) => columns.visible.has(column.key))

  const { totals, usHoldings: us } = data
  const taxFreeShare =
    Number(totals.gross) > 0 ? Number(totals.taxFreeGross) / Number(totals.gross) : null

  return (
    <>
      <PageHeader
        title="Dividends"
        meta={`${String(totals.count)} payment${totals.count === 1 ? '' : 's'} · ${yen(totals.gross)} gross`}
      >
        <AccountFilterControl value={account} onChange={setAccount} />
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
                {data.byYear.map((year) => (
                  <tr key={year.year}>
                    <td>{year.year}</td>
                    <td data-numeric>{year.count}</td>
                    <td data-numeric>{yen(year.gross)}</td>
                    <td data-numeric className={styles.dim}>{yen(year.tax)}</td>
                    <td data-numeric className={styles.profit}>{yen(year.net)}</td>
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
                {data.bySymbol.map((summary) => (
                  <tr key={summary.symbol}>
                    <td>
                      <InstrumentLink symbol={summary.symbol} name={summary.name} assetClass={summary.assetClass} />
                    </td>
                    <td data-numeric>{summary.count}</td>
                    <td data-numeric>{yen(summary.gross)}</td>
                    <td data-numeric className={styles.profit}>{yen(summary.net)}</td>
                    <td className={styles.dim}>{summary.lastPaid}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>

          <Section
            title="All payments"
            description="Gross is reconstructed from the credited amount — Rakuten's statement reports only what it paid out, never the pre-tax figure."
            actions={
              <ColumnMenu
                columns={PAYOUT_COLUMNS}
                hidden={columns.hidden}
                redundant={redundant}
                hiddenCount={columns.hiddenCount}
                onToggle={columns.toggle}
                onReset={columns.reset}
                label="Choose payment columns"
              />
            }
          >
            <Table>
              <thead>
                <tr>
                  {shown.map((column) => (
                    <th key={column.key} scope="col" data-numeric={column.numeric ? '' : undefined}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={`${row.payDate}-${row.symbol}-${row.accountType}-${row.netAmount}`}>
                    {shown.map((column) => (
                      <td
                        key={column.key}
                        data-numeric={column.numeric ? '' : undefined}
                        className={column.className ? styles[column.className] : undefined}
                      >
                        {column.cell(row, styles)}
                      </td>
                    ))}
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
              {us.quarterSpanning.map((ticker, index) => (
                <span key={ticker.symbol}>
                  {index > 0 ? (index === us.quarterSpanning.length - 1 ? ' and ' : ', ') : ''}
                  <strong>{ticker.symbol}</strong> ({ticker.days}d)
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
