import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { z } from 'zod'
import styles from './dashboard.module.scss'
import { MonthlyPnlChart } from '~/components/charts/MonthlyPnlChart'
import { MonthlyZeroBars } from '~/components/charts/MonthlyZeroBars'
import { EquitySparkline } from '~/components/dashboard/EquitySparkline'
import { pct, ratio, tone, yen, yenSigned } from '~/components/format'
import { HeroStat, PageHeader, Section, Stat, StatStrip, StripCell } from '~/components/screen'
import { AccountFilterControl } from '~/components/ui/AccountFilterControl'
import { useAccountFilter } from '~/components/ui/AccountSwitch'
import { useIsMobile } from '~/components/ui/useIsMobile'
import { accountScopeSchema } from '~/lib/accountScope'
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
  }).extend(accountScopeSchema.shape),
  loaderDeps: ({ search }) => ({ account: search.scope ?? 'ALL' }),
  loader: ({ deps }) => getDashboard({ data: { account: deps.account } }),
  // Declaring this puts a Suspense boundary around *this* match rather than
  // letting the suspended loader propagate up and take `AppShell` with it. That
  // is what lets the sidebar and this screen's chrome stream out in the first
  // flush instead of the browser holding an empty document until the engine has
  // run — the whole reason a Lighthouse run could report a 0.4s LCP against a
  // page that was visibly blank for 2.7s.
  pendingComponent: DashboardPending,
  component: Dashboard,
})

/** One value or hint placeholder, sized to the text it stands in for. */
function Bar({ width }: { width: string }) {
  return <span className={styles.pendingBar} style={{ width }} aria-hidden="true" />
}

const PENDING_TILES = ['Profit factor', 'Max drawdown', 'NISA headroom', 'US currency effect']
const PENDING_STRIP = ['Win rate', 'Total losses', 'Invested at cost', 'Open positions', 'NISA restoring']

function DashboardPending() {
  const [account, setAccount] = useAccountFilter()

  return (
    <div aria-busy="true">
      {/* `Loading…` rather than a bar, matching the Calendar screen. */}
      <PageHeader title="Dashboard" meta="Loading…">
        <AccountFilterControl value={account} onChange={setAccount} />
      </PageHeader>

      <div className={styles.heroBlock}>
        <HeroStat
          label="Realized P&L · all time"
          value={<Bar width="55%" />}
          context={<Bar width="70%" />}
        />
        <div className={styles.recentGrid}>
          {[0, 1].map((row) => (
            <div key={row} className={styles.pendingRecentCard} aria-hidden="true">
              <Bar width="40%" />
              <Bar width="60%" />
            </div>
          ))}
        </div>
      </div>

      <div className={styles.tiles}>
        {PENDING_TILES.map((label) => (
          <Stat key={label} label={label} value={<Bar width="50%" />} hint={<Bar width="70%" />} />
        ))}
      </div>

      <div className={styles.stripSpacing}>
        <StatStrip>
          {PENDING_STRIP.map((label) => (
            <StripCell key={label} label={label} value={<Bar width="60%" />} />
          ))}
        </StatStrip>
      </div>

      <Section
        title="Monthly realized P&L"
        description="Bars rise above the zero line in profitable months and fall below it in losing ones."
      >
        <div className={styles.pendingChart} aria-hidden="true" />
      </Section>
    </div>
  )
}

/** One period's numbers, condensed to a single line each — the full breakdown lives on Stats. */
function RecentCard({ period }: { period: PeriodSummary }) {
  const net = Number(period.realizedJpy)
  const netTone = tone(net)

  return (
    <div className={styles.recentCard}>
      <div className={styles.recentHead}>
        <span className={styles.recentLabel}>{period.label}</span>
        <span className={styles.recentCount}>
          {period.tradeCount} close{period.tradeCount === 1 ? '' : 's'}
        </span>
      </div>

      {period.tradeCount === 0 ? (
        <p className={styles.recentEmpty}>No closes</p>
      ) : (
        <>
          <div className={styles.recentNetRow}>
            <span
              className={cx(
                styles.recentNet,
                netTone === 'profit' && styles.profit,
                netTone === 'loss' && styles.loss,
              )}
            >
              {yenSigned(net)}
            </span>
            {period.returnPct != null ? (
              <span
                className={cx(
                  styles.recentPct,
                  netTone === 'profit' && styles.profit,
                  netTone === 'loss' && styles.loss,
                )}
              >
                {period.returnPct >= 0 ? '+' : ''}
                {(period.returnPct * 100).toFixed(1)}%
              </span>
            ) : null}
          </div>
          <div className={styles.recentDetail}>
            <span className={styles.profit}>{yen(period.grossProfitJpy)}</span>
            <span className={styles.recentDim}>/</span>
            <span className={styles.loss}>{yen(period.grossLossJpy)}</span>
            <span className={styles.recentDim}>
              {' '}
              · {period.winCount}W / {period.lossCount}L
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function Dashboard() {
  const d = Route.useLoaderData()
  const { back = 0 } = Route.useSearch()
  const [account, setAccount] = useAccountFilter()
  const navigate = Route.useNavigate()
  const isMobile = useIsMobile()

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

  // Merge onto `prev` rather than passing a bare object: the object form replaces
  // the whole search record, which silently dropped `scope` every time you paged
  // the chart and reset the screen to All accounts.
  const shift = (delta: number) => {
    void navigate({
      search: (prev) => ({ ...prev, back: Math.max(0, view.offset + delta) }),
      replace: true,
    })
  }

  const nav = {
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
      void navigate({ search: (prev) => ({ ...prev, back: 0 }), replace: true })
    },
  }

  const realized = Number(d.realizedJpy)
  const grossProfit = Number(d.grossProfitJpy)
  const profitFactorMeter = d.profitFactor == null ? undefined : Math.min(d.profitFactor / 5, 1)
  const maxDrawdownMeter =
    grossProfit > 0 ? Math.min(Number(d.maxDrawdownJpy) / grossProfit, 1) : undefined
  const nisaHeadroomMeter = Math.min(Number(d.nisaLifetimeUsed) / 18_000_000, 1)

  return (
    <>
      <PageHeader
        title="Dashboard"
        meta={`${String(d.tradeCount)} trades · ${String(d.openPositions)} open positions`}
      >
        <AccountFilterControl value={account} onChange={setAccount} />
      </PageHeader>

      <div className={styles.heroBlock}>
        <HeroStat
          label="Realized P&L · all time"
          value={yen(d.realizedJpy)}
          tone={tone(realized)}
          context={`${yen(d.grossProfitJpy)} gains · ${yen(d.grossLossJpy)} losses`}
          aside={
            d.equityCurve.length >= 2 ? (
              <EquitySparkline points={d.equityCurve} tone={tone(realized)} />
            ) : undefined
          }
        />
        <div className={styles.recentGrid}>
          <RecentCard period={d.week} />
          <RecentCard period={d.month} />
        </div>
      </div>

      <div className={styles.tiles}>
        <Stat
          label="Profit factor"
          value={d.profitFactor == null ? '—' : `${ratio(d.profitFactor)}×`}
          hint="¥ earned per ¥1 lost · above 1.0 is profitable"
          meter={profitFactorMeter}
        />
        <Stat
          label="Max drawdown"
          value={yen(d.maxDrawdownJpy)}
          tone="loss"
          hint="deepest peak-to-trough fall"
          meter={maxDrawdownMeter}
        />
        <Stat
          label="NISA headroom"
          value={yen(d.nisaLifetimeRemaining)}
          hint={`${yen(d.nisaLifetimeUsed)} of ¥18,000,000 used`}
          meter={nisaHeadroomMeter}
        />
        <Stat
          label="US currency effect"
          value={yenSigned(d.fxEffectJpy)}
          tone={tone(d.fxEffectJpy)}
          hint={`vs ${yenSigned(d.stockEffectJpy)} from share prices`}
          meter={d.fxShare ?? undefined}
        />
      </div>

      <div className={styles.stripSpacing}>
        <StatStrip>
          <StripCell label="Win rate" value={pct(d.winRate)} />
          <StripCell label="Total losses" value={yen(d.grossLossJpy)} tone="loss" />
          <StripCell label="Invested at cost" value={yen(d.investedAtCostJpy)} />
          <StripCell label="Open positions" value={String(d.openPositions)} />
          <StripCell
            label="NISA restoring"
            value={yen(d.nisaPendingRestoration)}
            hint={d.nisaRestorationDate}
          />
        </StatStrip>
      </div>

      <Section
        title="Monthly realized P&L"
        description={
          isMobile
            ? 'Rows grow right of zero in profitable months, left in losing ones.'
            : 'Bars rise above the zero line in profitable months and fall below it in losing ones.'
        }
      >
        {isMobile ? (
          <MonthlyZeroBars data={view.slice} nav={nav} />
        ) : (
          <MonthlyPnlChart data={view.slice} nav={nav} />
        )}
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
