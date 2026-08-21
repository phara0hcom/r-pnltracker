import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import styles from './tax.module.scss'
import { ACCOUNT_LABEL, pct, tone, yen } from '~/components/format'
import { Empty, PageHeader, Section, Stat, StatGrid, Table } from '~/components/screen'
import { accountScopeSchema } from '~/lib/accountScope'
import { cx } from '~/lib/cx'
import { getTax } from '~/server/screens'

export const Route = createFileRoute('/_authed/tax')({
  // `scope` is carried but not applied: this screen is built around the
  // 特定-vs-NISA split it already shows. Declared so the value survives a visit
  // here rather than being stripped as an unknown key.
  validateSearch: z
    .object({
      basis: z.enum(['CALENDAR', 'FISCAL_APR_MAR']).catch('CALENDAR'),
    })
    .extend(accountScopeSchema.shape),
  component: Tax,
})

function Tax() {
  const { basis } = Route.useSearch()
  const navigate = Route.useNavigate()

  const { data: taxData, isPending } = useQuery({
    queryKey: ['tax', basis],
    queryFn: () => getTax({ data: { basis } }),
  })

  if (isPending || !taxData) return <Empty>Loading tax figures…</Empty>

  const current = taxData.years.at(-1)

  return (
    <>
      <PageHeader
        title="Tax"
        meta="20.315% on 特定口座 realized gains. NISA is exempt. Estimates only — not tax advice."
      >
        <div className={styles.toggle} role="group" aria-label="Tax year basis">
          <button
            type="button"
            className={cx(styles.toggleButton, basis === 'CALENDAR' && styles.toggleActive)}
            onClick={() => {
              void navigate({ search: { basis: 'CALENDAR' } })
            }}
          >
            Jan–Dec
          </button>
          <button
            type="button"
            className={cx(styles.toggleButton, basis === 'FISCAL_APR_MAR' && styles.toggleActive)}
            onClick={() => {
              void navigate({ search: { basis: 'FISCAL_APR_MAR' } })
            }}
          >
            Apr–Mar
          </button>
        </div>
      </PageHeader>

      {basis === 'FISCAL_APR_MAR' ? (
        <p className={styles.warning}>
          April–March is the fiscal year (年度) used for budgets and corporate accounting. Japanese
          individual securities tax is <strong>calendar-year on a 受渡日 basis</strong>, so these
          figures will not match your 特定口座年間取引報告書. Use Jan–Dec for anything official.
        </p>
      ) : null}

      {current ? (
        <StatGrid>
          <Stat label={`${String(current.year)} net taxable`} value={yen(current.netTaxable)} />
          <Stat
            label="Estimated tax"
            value={yen(current.estimatedTax)}
            hint={`${yen(current.incomePortion)} income + ${yen(current.localPortion)} local`}
          />
          <Stat
            label="NISA gains"
            value={yen(current.nisaGains)}
            tone="profit"
            hint="tax-free"
          />
          <Stat
            label="Net after tax"
            value={yen(current.netAfterTax)}
            tone={tone(current.netAfterTax)}
          />
        </StatGrid>
      ) : null}

      <Section
        title="Year over year"
        description="Attributed by settlement date (受渡日), matching how Rakuten reports and withholds."
      >
        <Table>
          <thead>
            <tr>
              <th scope="col">Year</th>
              <th scope="col" data-numeric>Gains</th>
              <th scope="col" data-numeric>Losses</th>
              <th scope="col" data-numeric>Net taxable</th>
              <th scope="col" data-numeric>Est. tax</th>
              <th scope="col" data-numeric>NISA (free)</th>
              <th scope="col" data-numeric>Dividends</th>
              <th scope="col" data-numeric>Trades</th>
              <th scope="col" data-numeric>Win%</th>
              <th scope="col" data-numeric>Net after tax</th>
            </tr>
          </thead>
          <tbody>
            {taxData.years.map((year) => (
              <tr key={year.year}>
                <td>{year.year}</td>
                <td data-numeric className={styles.profit}>{yen(year.taxableGains)}</td>
                <td data-numeric className={styles.loss}>{yen(year.taxableLosses)}</td>
                <td data-numeric>{yen(year.netTaxable)}</td>
                <td data-numeric>{yen(year.estimatedTax)}</td>
                <td data-numeric className={styles.profit}>{yen(year.nisaGains)}</td>
                <td data-numeric>{yen(Number(year.dividendGross) + Number(year.nisaDividends))}</td>
                <td data-numeric>{year.tradeCount}</td>
                <td data-numeric>{pct(year.winRate, 0)}</td>
                <td data-numeric className={tone(year.netAfterTax)}>{yen(year.netAfterTax)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td data-numeric>{yen(taxData.totals.taxableGains)}</td>
              <td data-numeric />
              <td data-numeric />
              <td data-numeric>{yen(taxData.totals.estimatedTax)}</td>
              <td data-numeric>{yen(taxData.totals.nisaGains)}</td>
              <td data-numeric colSpan={3} />
              <td data-numeric>{yen(taxData.totals.netAfterTax)}</td>
            </tr>
          </tfoot>
        </Table>

        {taxData.years.some((year) => Number(year.carryforwardLoss) > 0) ? (
          <p className={styles.note}>
            Years that net to a loss show a carryforward. Japanese rules allow a 3-year 繰越控除, but
            only if you file a return — it is not automatic under 源泉徴収あり.
          </p>
        ) : null}
      </Section>

      <Section
        title="Dividends"
        description="Attributed to accounts by matching holdings, since the statement's cash ledger has no account column."
      >
        {taxData.dividends.length === 0 ? (
          <Empty>No dividends recorded.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">Paid</th>
                <th scope="col">Type</th>
                <th scope="col">Account</th>
                <th scope="col" data-numeric>Gross</th>
                <th scope="col" data-numeric>Withheld</th>
                <th scope="col" data-numeric>Net</th>
              </tr>
            </thead>
            <tbody>
              {taxData.dividends.map((payout, index) => (
                <tr key={`${payout.payDate}-${String(index)}`}>
                  <td>{payout.payDate}</td>
                  <td>{payout.kind === 'DIVIDEND' ? '配当金' : '分配金'}</td>
                  <td>
                    {ACCOUNT_LABEL[payout.accountType] ?? payout.accountType}
                    {payout.isTaxable ? null : <span className={styles.tag}>tax-free</span>}
                    {payout.confident ? null : (
                      <span className={styles.tag} title="Paid after the position closed; account inferred from the last holder">
                        inferred
                      </span>
                    )}
                  </td>
                  <td data-numeric>{yen(payout.grossAmount)}</td>
                  <td data-numeric>{Number(payout.tax) === 0 ? '—' : yen(payout.tax)}</td>
                  <td data-numeric>{yen(payout.netAmount)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className={styles.note}>
          US dividends are not included — Rakuten reports them in a separate 外国株式配当金計算書
          that is not part of the trade-history or 取引残高報告書 exports.
        </p>
      </Section>
    </>
  )
}
