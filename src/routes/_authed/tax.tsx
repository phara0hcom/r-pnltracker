import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import styles from './tax.module.scss'
import { AccountDot } from '~/components/AccountDot'
import { ACCOUNT_LABEL, pct, tone, yen } from '~/components/format'
import { Empty, HeroStat, PageHeader, SegmentedTabs, StatStrip, StripCell, Table } from '~/components/screen'
import { DerivationBand, type DerivationNode } from '~/components/tax/DerivationBand'
import { useIsMobile } from '~/components/ui/useIsMobile'
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

const TABS = [
  { id: 'thisYear' as const, label: 'This year' },
  { id: 'byYear' as const, label: 'By year' },
  { id: 'dividends' as const, label: 'Dividends' },
]

function Tax() {
  const { basis } = Route.useSearch()
  const navigate = Route.useNavigate()
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('thisYear')

  const { data: taxData, isPending } = useQuery({
    queryKey: ['tax', basis],
    queryFn: () => getTax({ data: { basis } }),
  })

  if (isPending || !taxData) return <Empty>Loading tax figures…</Empty>

  const current = taxData.years.at(-1)
  // Most recent year that generated a carryforward — the app does not track
  // whether a subsequent year's gains have already absorbed it, matching the
  // note below, which is deliberately a caveat rather than a precise figure.
  const carryforwardYear = [...taxData.years].reverse().find((year) => Number(year.carryforwardLoss) > 0)
  const firstYear = taxData.years[0]?.year
  const lastYear = taxData.years.at(-1)?.year

  const nodes: DerivationNode[] = current
    ? [
        {
          id: 'gains',
          label: 'Taxable gains',
          value: `+${yen(current.taxableGains)}`,
          hint: '特定口座 only',
          tone: 'profit',
          size: 'var(--text-lg)',
          op: '−',
        },
        {
          id: 'losses',
          label: 'Taxable losses',
          value: `−${yen(current.taxableLosses)}`,
          hint: 'offset in-year',
          tone: 'loss',
          size: 'var(--text-lg)',
          op: '=',
        },
        {
          id: 'net',
          label: 'Net taxable',
          value: yen(current.netTaxable),
          hint: '受渡日 basis',
          size: 'var(--text-lg)',
          op: '×',
        },
        {
          id: 'rate',
          label: 'Rate',
          value: '20.315%',
          hint: '15% + 5% + 0.315%',
          size: 'var(--text-lg)',
          op: '=',
        },
        {
          id: 'tax',
          label: 'Estimated tax',
          value: yen(current.estimatedTax),
          hint: `${yen(current.incomePortion)} + ${yen(current.localPortion)}`,
          size: 'var(--text-xl)',
          op: '',
        },
      ]
    : []

  const dividendGrossTotal = current ? Number(current.dividendGross) + Number(current.nisaDividends) : 0
  const dividendNet = current
    ? Number(current.dividendGross) - Number(current.dividendWithheld) + Number(current.nisaDividends)
    : 0

  const strip: { label: string; value: string; hint?: string; tone?: 'profit' | 'loss' | 'flat' }[] = current
    ? [
        { label: 'NISA gains', value: yen(current.nisaGains), tone: 'profit', hint: 'tax-free' },
        {
          label: 'Dividends net',
          value: yen(dividendNet),
          hint: `${yen(dividendGrossTotal)} gross − ${yen(current.dividendWithheld)}`,
        },
        {
          label: 'Carryforward',
          value: carryforwardYear ? yen(carryforwardYear.carryforwardLoss) : '—',
          tone: 'loss',
          hint: carryforwardYear ? `from ${String(carryforwardYear.year)} · 3-year 繰越控除` : undefined,
        },
        { label: 'Effective rate', value: pct(current.effectiveRate), hint: 'of gross gains' },
        {
          label: `Est. tax, ${String(taxData.years.length)} year${taxData.years.length === 1 ? '' : 's'}`,
          value: yen(taxData.totals.estimatedTax),
          hint: firstYear != null && lastYear != null ? `${String(firstYear)}–${String(lastYear)}` : undefined,
        },
      ]
    : []

  const yearOverYearTable = (
    <Table>
      <thead>
        <tr>
          <th scope="col">Year</th>
          <th scope="col" data-numeric>Gains</th>
          <th scope="col" data-numeric>Losses</th>
          <th scope="col" data-numeric>Net taxable</th>
          <th scope="col" data-numeric>Est. tax</th>
          <th scope="col" data-numeric>NISA (free)</th>
          <th scope="col" data-numeric>Net after tax</th>
        </tr>
      </thead>
      <tbody>
        {taxData.years.map((year) => (
          <tr key={year.year}>
            <td className={styles.yearCell}>{year.year}</td>
            <td data-numeric className={styles.profit}>{yen(year.taxableGains)}</td>
            <td data-numeric className={styles.loss}>{yen(year.taxableLosses)}</td>
            <td data-numeric className={Number(year.netTaxable) < 0 ? styles.loss : undefined}>
              {yen(year.netTaxable)}
            </td>
            <td data-numeric>{Number(year.estimatedTax) === 0 ? '—' : yen(year.estimatedTax)}</td>
            <td data-numeric className={styles.profit}>{yen(year.nisaGains)}</td>
            <td data-numeric className={cx(styles.yearCell, tone(year.netAfterTax))}>{yen(year.netAfterTax)}</td>
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
          <td data-numeric className={styles.profit}>{yen(taxData.totals.nisaGains)}</td>
          <td data-numeric className={cx(styles.yearCell, styles.profit)}>{yen(taxData.totals.netAfterTax)}</td>
        </tr>
      </tfoot>
    </Table>
  )

  const dividendsTable =
    taxData.dividends.length === 0 ? (
      <Empty>No dividends recorded.</Empty>
    ) : (
      <Table>
        <thead>
          <tr>
            <th scope="col">Paid</th>
            <th scope="col">Account</th>
            <th scope="col" data-numeric>Net</th>
          </tr>
        </thead>
        <tbody>
          {taxData.dividends.map((payout, index) => (
            <tr key={`${payout.payDate}-${String(index)}`}>
              <td className={styles.stackCell}>
                {payout.payDate}
                <span className={styles.stackSub}>{payout.kind === 'DIVIDEND' ? '配当金' : '分配金'}</span>
              </td>
              <td>
                <span className={styles.accountCell}>
                  <AccountDot accountType={payout.accountType} />
                  {ACCOUNT_LABEL[payout.accountType] ?? payout.accountType}
                  {payout.isTaxable ? null : <span className={styles.tag}>tax-free</span>}
                  {payout.confident ? null : (
                    <span
                      className={styles.tag}
                      title="Paid after the position closed; account inferred from the last holder"
                    >
                      inferred
                    </span>
                  )}
                </span>
              </td>
              <td data-numeric className={styles.stackCell}>
                {yen(payout.netAmount)}
                <span className={styles.stackSub}>
                  {Number(payout.tax) === 0
                    ? `${yen(payout.grossAmount)} gross`
                    : `${yen(payout.grossAmount)} − ${yen(payout.tax)}`}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    )

  return (
    <>
      <PageHeader
        title="Tax"
        meta={
          isMobile
            ? '20.315% · NISA exempt · estimates'
            : '20.315% on 特定口座 realized gains. NISA is exempt. Estimates only — not tax advice.'
        }
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
        <div className={styles.heroRow}>
          <HeroStat
            label={`${String(current.year)} estimated tax`}
            value={yen(current.estimatedTax)}
            context={`${yen(current.incomePortion)} income + ${yen(current.localPortion)} local`}
          />
          {isMobile ? null : (
            <StatStrip>
              {strip.map((cell) => (
                <StripCell key={cell.label} label={cell.label} value={cell.value} hint={cell.hint} tone={cell.tone} />
              ))}
            </StatStrip>
          )}
        </div>
      ) : null}

      {isMobile ? <SegmentedTabs tabs={TABS} active={tab} onChange={setTab} label="Section" /> : null}

      {isMobile ? (
        <>
          {tab === 'thisYear' && current ? (
            <>
              <h2 className={styles.spSectionTitle}>How it gets there</h2>
              <dl className={styles.spChain}>
                {nodes.map((node, index) => (
                  <div key={node.id} className={styles.spChainRow}>
                    <dt>
                      <span className={styles.spChainOp}>{index === 0 ? '' : (nodes[index - 1]?.op ?? '')}</span>
                      {node.label}
                      <span className={styles.spHint}> {node.hint}</span>
                    </dt>
                    <dd className={cx(node.tone === 'profit' && styles.profit, node.tone === 'loss' && styles.loss)}>
                      {node.value}
                    </dd>
                  </div>
                ))}
                <div className={styles.spChainNetRow}>
                  <dt className={styles.spNetLabel}>Net after tax</dt>
                  <dd className={cx(styles.spNetValue, tone(current.netAfterTax))}>{yen(current.netAfterTax)}</dd>
                </div>
              </dl>

              <dl className={styles.spStrip}>
                {strip.map((cell) => (
                  <div key={cell.label} className={styles.spStripRow}>
                    <dt>
                      {cell.label}
                      {cell.hint ? <span className={styles.spHint}> {cell.hint}</span> : null}
                    </dt>
                    <dd className={cx(cell.tone === 'profit' && styles.profit, cell.tone === 'loss' && styles.loss)}>
                      {cell.value}
                    </dd>
                  </div>
                ))}
              </dl>

              {carryforwardYear ? (
                <p className={styles.note}>
                  {yen(carryforwardYear.carryforwardLoss)} carries forward from {carryforwardYear.year}. The
                  3-year 繰越控除 applies only if you file — not automatic under 源泉徴収あり.
                </p>
              ) : null}
            </>
          ) : null}

          {tab === 'byYear' ? yearOverYearTable : null}
          {tab === 'dividends' ? (
            <>
              {dividendsTable}
              <p className={styles.note}>
                US dividends are not included — Rakuten reports them in a separate 外国株式配当金計算書
                that is not part of the trade-history or 取引残高報告書 exports.
              </p>
            </>
          ) : null}
        </>
      ) : (
        <>
          {current ? (
            <section className={styles.derivationCard}>
              <div className={styles.derivationHead}>
                <h2 className={styles.derivationTitle}>How {current.year} gets to {yen(current.estimatedTax)}</h2>
                <p className={styles.derivationDesc}>
                  Attributed by settlement date (受渡日), matching how Rakuten reports and withholds.
                </p>
              </div>
              <DerivationBand
                nodes={nodes}
                netAfterTax={{
                  value: yen(current.netAfterTax),
                  hint: `incl. ${yen(current.nisaGains)} NISA, exempt`,
                  tone: tone(current.netAfterTax),
                }}
              />
            </section>
          ) : null}

          <div className={styles.twoCol}>
            <section>
              <h2 className={styles.colTitle}>Year over year</h2>
              <p className={styles.colDesc}>Trade counts and win rates live on Stats.</p>
              {yearOverYearTable}
              {carryforwardYear ? (
                <p className={styles.note}>
                  {carryforwardYear.year} nets to a loss, so {yen(carryforwardYear.carryforwardLoss)} carries
                  forward. Japanese rules allow a 3-year 繰越控除, but only if you file a return — it is not
                  automatic under 源泉徴収あり.
                </p>
              ) : null}
            </section>

            <section>
              <h2 className={styles.colTitle}>Dividends</h2>
              <p className={styles.colDesc}>Attributed to accounts by matching holdings.</p>
              {dividendsTable}
              <p className={styles.note}>
                US dividends are not included — Rakuten reports them in a separate 外国株式配当金計算書
                that is not part of the trade-history or 取引残高報告書 exports.
              </p>
            </section>
          </div>
        </>
      )}
    </>
  )
}
