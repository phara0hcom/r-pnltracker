import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { z } from 'zod'
import styles from './dashboard.module.scss'
import { MonthlyPnlChart } from '~/components/charts/MonthlyPnlChart'
import { PeriodCard } from '~/components/dashboard/PeriodCard'
import { pct, ratio, tone, yen, yenSigned } from '~/components/format'
import { PageHeader, Section, Stat, StatGrid } from '~/components/screen'
import { AccountSwitch, useAccountFilter } from '~/components/ui/AccountSwitch'
import { accountScopeSchema } from '~/lib/accountScope'
import { getDashboard } from '~/server/portfolio'

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

/**
 * The tiles carry their real labels while the figures load.
 *
 * Labels and static hints are known without any data, so they are rendered
 * rather than blanked: it makes the wait informative, and it keeps each tile the
 * height it will be once the numbers land. Only the hints that interpolate a
 * figure become bars.
 */
const PENDING_STATS: { label: string; hint?: React.ReactNode }[] = [
  { label: 'Realized P&L', hint: 'all time, closed trades' },
  { label: 'Total losses', hint: <Bar width="70%" /> },
  { label: 'Invested (at cost)', hint: <Bar width="80%" /> },
  { label: 'Win rate' },
  { label: 'Profit factor', hint: '¥ earned per ¥1 lost · above 1.0 is profitable' },
  { label: 'Max drawdown', hint: 'deepest peak-to-trough fall' },
  { label: 'NISA headroom', hint: <Bar width="65%" /> },
  { label: 'US currency effect', hint: <Bar width="60%" /> },
]

function DashboardPending() {
  const [account, setAccount] = useAccountFilter()

  return (
    <div aria-busy="true">
      {/* `Loading…` rather than a bar, matching the Calendar screen. */}
      <PageHeader title="Dashboard" meta="Loading…">
        <AccountSwitch value={account} onChange={setAccount} />
      </PageHeader>

      <StatGrid>
        {PENDING_STATS.map((stat) => (
          <Stat key={stat.label} label={stat.label} value={<Bar width="55%" />} hint={stat.hint} />
        ))}
      </StatGrid>

      <Section title="Recent activity">
        <div className={styles.periods}>
          <PendingPeriodCard />
          <PendingPeriodCard />
        </div>
      </Section>

      <Section
        title="Monthly realized P&L"
        description="Bars rise above the zero line in profitable months and fall below it in losing ones."
      >
        <div className={styles.pendingChart} aria-hidden="true" />
      </Section>
    </div>
  )
}

function PendingPeriodCard() {
  return (
    <div className={styles.pendingCard} aria-hidden="true">
      <Bar width="35%" />
      <span className={styles.pendingNet}>
        <Bar width="55%" />
      </span>
      {[0, 1, 2, 3].map((row) => (
        <Bar key={row} width="100%" />
      ))}
    </div>
  )
}

function Dashboard() {
  const d = Route.useLoaderData()
  const { back = 0 } = Route.useSearch()
  const [account, setAccount] = useAccountFilter()
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
      >
        <AccountSwitch value={account} onChange={setAccount} />
      </PageHeader>

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
