import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { z } from 'zod'
import styles from './dashboard.module.scss'
import { MonthlyPnlChart } from '~/components/charts/MonthlyPnlChart'
import { pct, ratio, tone, yen, yenSigned } from '~/components/format'
import { PageHeader, Section, Stat, StatGrid } from '~/components/Screen'
import { cx } from '~/lib/cx'
import { getDashboard, type PeriodSummary } from '~/server/portfolio'

/** How many months the chart shows at once. */
const WINDOW = 12

export const Route = createFileRoute('/_authed/dashboard')({
  // The window offset lives in the URL so a particular period stays shareable
  // and survives a refresh, consistent with the trades and calendar screens.
  // Optional, not defaulted: a required param would force every redirect to
  // /dashboard to supply it, which typecheck caught immediately.
  validateSearch: z.object({
    back: z.number().int().min(0).catch(0).optional(),
  }),
  loader: () => getDashboard(),
  component: Dashboard,
})

function Dashboard() {
  const d = Route.useLoaderData()
  const { back = 0 } = Route.useSearch()
  const navigate = Route.useNavigate()

  // The server sends the whole gap-filled history; windowing here means paging
  // back costs no round-trip.
  const view = useMemo(() => {
    const total = d.monthly.length
    const maxBack = Math.max(0, total - WINDOW)
    const offset = Math.min(back, maxBack)
    const end = total - offset
    const start = Math.max(0, end - WINDOW)
    const slice = d.monthly.slice(start, end)

    return {
      slice,
      canGoBack: start > 0,
      canGoForward: offset > 0,
      offset,
      label:
        slice.length === 0
          ? ''
          : slice.length === 1
            ? (slice[0]?.month ?? '')
            : `${slice[0]?.month ?? ''} – ${slice.at(-1)?.month ?? ''}`,
    }
  }, [d.monthly, back])

  const shift = (delta: number) => {
    void navigate({ search: { back: Math.max(0, view.offset + delta) }, replace: true })
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        meta={`${String(d.tradeCount)} trades · ${String(d.openPositions)} open positions`}
      />

      <StatGrid>
        <Stat
          label="Realized P&L"
          value={yen(d.realizedJpy)}
          tone={tone(d.realizedJpy)}
          hint="all time, closed trades"
        />
        <Stat
          label="Total losses"
          value={yen(d.grossLossJpy)}
          tone="loss"
          hint={`against ${yen(d.grossProfitJpy)} of gains`}
        />
        <Stat
          label="Invested (at cost)"
          value={yen(d.investedAtCostJpy)}
          hint={`${String(d.openPositions)} open positions, at purchase price`}
        />
        <Stat label="Win rate" value={pct(d.winRate)} />
        <Stat
          label="Profit factor"
          value={d.profitFactor == null ? '—' : `${ratio(d.profitFactor)}×`}
          hint="¥ earned per ¥1 lost · above 1.0 is profitable"
        />
        <Stat
          label="Max drawdown"
          value={yen(d.maxDrawdownJpy)}
          tone="loss"
          hint="deepest peak-to-trough fall"
        />
        <Stat
          label="NISA headroom"
          value={yen(d.nisaLifetimeRemaining)}
          hint={`${yen(d.nisaLifetimeUsed)} of ¥18,000,000 used`}
        />
        <Stat
          label="US currency effect"
          value={yenSigned(d.fxEffectJpy)}
          tone={tone(d.fxEffectJpy)}
          hint={`vs ${yenSigned(d.stockEffectJpy)} from share prices`}
        />
      </StatGrid>

      <Section title="Recent activity">
        <div className={styles.periods}>
          <PeriodCard period={d.week} />
          <PeriodCard period={d.month} />
        </div>
      </Section>

      <Section
        title="Monthly realized P&L"
        description="Bars rise above the zero line in profitable months and fall below it in losing ones."
      >
        <MonthlyPnlChart
          data={view.slice}
          nav={{
            label: view.label,
            canGoBack: view.canGoBack,
            canGoForward: view.canGoForward,
            onBack: () => {
              shift(WINDOW)
            },
            onForward: () => {
              shift(-WINDOW)
            },
            onLatest: () => {
              void navigate({ search: { back: 0 }, replace: true })
            },
          }}
        />
      </Section>

      {d.nisaGrowthMaxedYear != null ? (
        <p className={styles.callout}>
          Your {d.nisaGrowthMaxedYear} 成長投資枠 is fully used — ¥2,400,000 of ¥2,400,000. Annual
          frames never restore, so anything unused expires on 31 December.
        </p>
      ) : null}

      {Number(d.nisaPendingRestoration) > 0 ? (
        <p className={styles.note}>
          {yen(d.nisaPendingRestoration)} of NISA lifetime quota returns in {d.nisaRestorationDate},
          from positions sold this year.
        </p>
      ) : null}
    </>
  )
}

/**
 * One period's numbers.
 *
 * Wins and losses are shown separately rather than only the net: a flat month
 * from no trading and a flat month from ¥500k of gains cancelling ¥500k of
 * losses are very different months, and the net alone hides that.
 */
function PeriodCard({ period }: { period: PeriodSummary }) {
  const net = Number(period.realizedJpy)
  const quiet = period.tradeCount === 0

  return (
    <div className={styles.period}>
      <div className={styles.periodHead}>
        <h3 className={styles.periodTitle}>{period.label}</h3>
        <span className={styles.periodCount}>
          {period.tradeCount} close{period.tradeCount === 1 ? '' : 's'}
        </span>
      </div>

      {quiet ? (
        <p className={styles.periodEmpty}>No closed trades in this period.</p>
      ) : (
        <>
          <div className={styles.periodNetRow}>
            <span
              className={cx(
                styles.periodNet,
                net > 0 ? styles.profit : net < 0 ? styles.loss : undefined,
              )}
            >
              {yenSigned(net)}
            </span>
            {period.returnPct != null ? (
              <span
                className={cx(
                  styles.periodPct,
                  period.returnPct > 0
                    ? styles.profit
                    : period.returnPct < 0
                      ? styles.loss
                      : undefined,
                )}
                title={`on ${yen(period.costJpy)} of closed cost basis`}
              >
                {period.returnPct >= 0 ? '+' : ''}
                {(period.returnPct * 100).toFixed(1)}%
              </span>
            ) : null}
          </div>
          <dl className={styles.periodRows}>
            <div className={styles.periodRow}>
              <dt>Gains</dt>
              <dd className={styles.profit}>{yen(period.grossProfitJpy)}</dd>
            </div>
            <div className={styles.periodRow}>
              <dt>Losses</dt>
              <dd className={styles.loss}>{yen(period.grossLossJpy)}</dd>
            </div>
            <div className={styles.periodRow}>
              <dt>Closed cost</dt>
              <dd className={styles.periodDim}>{yen(period.costJpy)}</dd>
            </div>
            <div className={styles.periodRow}>
              <dt>Win rate</dt>
              <dd>
                {pct(period.winRate, 0)}
                <span className={styles.periodDim}>
                  {' '}
                  ({period.winCount}W / {period.lossCount}L)
                </span>
              </dd>
            </div>
          </dl>
        </>
      )}
    </div>
  )
}
