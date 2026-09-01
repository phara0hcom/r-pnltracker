import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import styles from './dividends.module.scss'
import { AccountDot } from '~/components/AccountDot'
import { YearBars } from '~/components/dividends/YearBars'
import { ACCOUNT_LABEL, qty, yen } from '~/components/format'
import { InstrumentLink } from '~/components/InstrumentLink'
import { Empty, HeroStat, PageHeader, SegmentedTabs, Section, StatStrip, StripCell, Table } from '~/components/screen'
import { AccountFilterControl } from '~/components/ui/AccountFilterControl'
import { useAccountFilter } from '~/components/ui/AccountSwitch'
import { ColumnMenu } from '~/components/ui/ColumnMenu'
import { useColumnVisibility } from '~/components/ui/useColumnVisibility'
import { useIsMobile } from '~/components/ui/useIsMobile'
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

const MONTH_ABBREV = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthYear(date: string): string {
  const [year, month] = date.split('-').map(Number)
  return `${MONTH_ABBREV[(month ?? 1) - 1] ?? ''} ${String(year ?? '')}`
}

const TABS = [
  { id: 'summary' as const, label: 'Summary' },
  { id: 'instruments' as const, label: 'Instruments' },
  { id: 'payments' as const, label: 'Payments' },
]

/** SP "recent payments" row — a two-column list replacing a table row. */
function RecentPaymentRow({ row }: { row: DividendRow }) {
  const tax = Number(row.incomeTax) + Number(row.localTax)

  return (
    <div className={styles.recentRow}>
      <span className={styles.recentMain}>
        <span className={styles.recentSymbol}>{row.symbol}</span>
        <span className={styles.recentMeta}>
          <AccountDot accountType={row.accountType} />
          {row.payDate} · {ACCOUNT_LABEL[row.accountType] ?? row.accountType} · {KIND_LABEL[row.kind] ?? row.kind}
        </span>
      </span>
      <span className={styles.recentAmounts}>
        <span className={styles.recentNet}>{yen(row.netAmount)}</span>
        <span className={styles.recentSub}>
          {tax === 0 ? `${yen(row.grossAmount)} gross · tax-free` : `${yen(row.grossAmount)} − ${yen(tax)}`}
        </span>
      </span>
    </div>
  )
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
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('summary')
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

  const highlights = useMemo(() => {
    let reinvestedJpy = 0
    let reinvestedUnits = 0
    let largest: DividendRow | null = null
    for (const row of data.rows) {
      if (row.reinvestedJpy != null) {
        reinvestedJpy += Number(row.reinvestedJpy)
        reinvestedUnits += Number(row.reinvestedUnits ?? '0')
      }
      if (!largest || Number(row.grossAmount) > Number(largest.grossAmount)) largest = row
    }
    // Rows arrive newest-first from the server, so the first row is the latest payment.
    const lastPaid = data.rows[0] ?? null
    return { reinvestedJpy, reinvestedUnits, largest, lastPaid }
  }, [data.rows])

  const strip = (
    <>
      <StripCell label="Gross received" value={yen(totals.gross)} hint={`${totals.count} payments`} />
      <StripCell
        label="Withheld"
        value={yen(totals.tax)}
        hint={Number(totals.tax) === 0 ? 'nothing withheld' : '20.315% on 特定 only'}
      />
      <StripCell
        label="Tax-free"
        value={taxFreeShare == null ? '—' : `${(taxFreeShare * 100).toFixed(1)}%`}
        tone="profit"
        hint={`${yen(totals.taxFreeGross)} paid into NISA`}
      />
      <StripCell
        label="Reinvested"
        value={yen(highlights.reinvestedJpy)}
        hint={`${qty(highlights.reinvestedUnits)} 口 added`}
      />
      <StripCell
        label="Largest payment"
        value={highlights.largest ? yen(highlights.largest.grossAmount) : '—'}
        hint={highlights.largest ? `${highlights.largest.symbol} · ${monthYear(highlights.largest.payDate)}` : undefined}
      />
      <StripCell
        label="Last paid"
        value={highlights.lastPaid?.payDate ?? '—'}
        hint={highlights.lastPaid ? `${highlights.lastPaid.symbol} · ${KIND_LABEL[highlights.lastPaid.kind] ?? highlights.lastPaid.kind}` : undefined}
      />
    </>
  )

  const byInstrumentTable = (
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
  )

  const allPaymentsSection = (
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
    </Section>
  )

  return (
    <>
      <PageHeader
        title="Dividends"
        meta={
          isMobile
            ? `${String(totals.count)} payment${totals.count === 1 ? '' : 's'} · ${yen(totals.gross)} gross`
            : `${String(totals.count)} payment${totals.count === 1 ? '' : 's'} · ${yen(totals.gross)} gross · from 取引残高報告書 statements`
        }
      >
        <AccountFilterControl value={account} onChange={setAccount} />
      </PageHeader>

      <div className={styles.heroRow}>
        <HeroStat
          label="Net received"
          value={yen(totals.net)}
          tone="profit"
          context={`${yen(totals.gross)} gross − ${yen(totals.tax)} withheld`}
        />
        {isMobile ? null : <StatStrip>{strip}</StatStrip>}
      </div>

      {data.rows.length === 0 ? (
        <Empty>
          No dividends recorded. They come from 取引残高報告書 statements — the trade history
          exports do not contain them.
        </Empty>
      ) : isMobile ? (
        <>
          <SegmentedTabs tabs={TABS} active={tab} onChange={setTab} label="Section" />

          {tab === 'summary' ? (
            <>
              <dl className={styles.spStrip}>
                {[
                  { label: 'Gross received', value: yen(totals.gross), hint: `${totals.count} payments` },
                  { label: 'Withheld', value: yen(totals.tax), hint: Number(totals.tax) === 0 ? 'nothing withheld' : '20.315% on 特定 only' },
                  { label: 'Tax-free', value: taxFreeShare == null ? '—' : `${(taxFreeShare * 100).toFixed(1)}%`, hint: `${yen(totals.taxFreeGross)} paid into NISA`, tone: 'profit' as const },
                  { label: 'Reinvested', value: yen(highlights.reinvestedJpy), hint: `${qty(highlights.reinvestedUnits)} 口 added` },
                  { label: 'Largest payment', value: highlights.largest ? yen(highlights.largest.grossAmount) : '—', hint: highlights.largest ? `${highlights.largest.symbol} · ${monthYear(highlights.largest.payDate)}` : undefined },
                  { label: 'Last paid', value: highlights.lastPaid?.payDate ?? '—', hint: highlights.lastPaid ? `${highlights.lastPaid.symbol} · ${KIND_LABEL[highlights.lastPaid.kind] ?? highlights.lastPaid.kind}` : undefined },
                ].map((cell) => (
                  <div key={cell.label} className={styles.spStripRow}>
                    <dt>
                      {cell.label}
                      {cell.hint ? <span className={styles.spHint}> {cell.hint}</span> : null}
                    </dt>
                    <dd className={cell.tone === 'profit' ? styles.profit : undefined}>{cell.value}</dd>
                  </div>
                ))}
              </dl>

              <h2 className={styles.spSectionTitle}>By year</h2>
              <p className={styles.spSectionDesc}>Net beside withheld, dated on the payment date.</p>
              <YearBars years={data.byYear} />

              <h2 className={styles.spSectionTitle}>Recent payments</h2>
              <div className={styles.recentList}>
                {data.rows.slice(0, 8).map((row, index) => (
                  <RecentPaymentRow key={`${row.payDate}-${row.symbol}-${String(index)}`} row={row} />
                ))}
              </div>
              {us.tickerCount > 0 ? (
                <p className={styles.spNote}>
                  No US dividend income is recorded across {us.tickerCount} US tickers — Rakuten
                  publishes foreign dividends only in a separate 外国株式配当金計算書, in neither
                  export.
                </p>
              ) : null}
            </>
          ) : null}

          {tab === 'instruments' ? byInstrumentTable : null}
          {tab === 'payments' ? allPaymentsSection : null}
        </>
      ) : (
        <>
          <div className={styles.twoCol}>
            <section>
              <h2 className={styles.colTitle}>By year</h2>
              <p className={styles.colDesc}>Dated on the payment date, when the cash and any withholding actually land.</p>
              <YearBars years={data.byYear} />
            </section>
            <section>
              <h2 className={styles.colTitle}>By instrument</h2>
              <p className={styles.colDesc}>Ranked by gross received.</p>
              {byInstrumentTable}
            </section>
          </div>

          {allPaymentsSection}
        </>
      )}
    </>
  )
}
