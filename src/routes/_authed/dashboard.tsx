import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { z } from 'zod'
import styles from './dashboard.module.scss'
import { MonthlyPnlChart } from '~/components/charts/MonthlyPnlChart'
import { MonthlyZeroBars } from '~/components/charts/MonthlyZeroBars'
import { EquitySparkline } from '~/components/dashboard/EquitySparkline'
import { NisaQuotaCard } from '~/components/dashboard/NisaQuotaCard'
import { TaxYearCard } from '~/components/dashboard/TaxYearCard'
import { pct, pctSigned, ratio, tone, yen, yenSigned } from '~/components/format'
import { MarketBreakdown, MarketInline } from '~/components/pnl/MarketSplit'
import { HeroStat, PageHeader, Section, Stat } from '~/components/screen'
import { AccountFilterControl } from '~/components/ui/AccountFilterControl'
import { useAccountFilter } from '~/components/ui/AccountSwitch'
import { useIsMobile } from '~/components/ui/useIsMobile'
import { accountScopeSchema } from '~/lib/accountScope'
import { cx } from '~/lib/cx'
import { getDashboard, type PeriodSummary } from '~/server/portfolio'

/** How many months the chart shows at once. */
const WINDOW = 12

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

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

const PENDING_TILES = ['Win rate', 'Profit factor', 'Max drawdown', 'US currency effect']

function DashboardPending() {
  const [account, setAccount] = useAccountFilter()

  return (
    <div aria-busy="true">
      {/* `Loading…` rather than a bar, matching the Calendar screen. */}
      <PageHeader
        title="Dashboard"
        meta="Loading…"
        filter={<AccountFilterControl value={account} onChange={setAccount} />}
      />

      <div className={styles.results}>
        <HeroStat
          label="Realized P&L · all time"
          value={<Bar width="55%" />}
          context={<Bar width="70%" />}
        />
        <div className={styles.recent}>
          {[0, 1].map((row) => (
            <div key={row} className={styles.pendingRecent} aria-hidden="true">
              <Bar width="40%" />
              <Bar width="60%" />
            </div>
          ))}
        </div>
      </div>

      <Section title="Performance">
        <div className={styles.tiles}>
          {PENDING_TILES.map((label) => (
            <Stat key={label} label={label} value={<Bar width="50%" />} hint={<Bar width="70%" />} />
          ))}
        </div>
      </Section>

      <div className={styles.pendingQuota} aria-hidden="true" />

      <Section
        title="Monthly realized P&L"
        description="Above the line in profitable months, below it in losing ones."
      >
        <div className={styles.pendingChart} aria-hidden="true" />
      </Section>
    </div>
  )
}

/** `2026-09-21`–`2026-09-27` → `21–27 Sep`; a whole month → `September`. */
function rangeLabel(from: string, to: string): string {
  const day = (iso: string) => String(Number(iso.slice(8, 10)))
  const month = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''
  if (from.slice(8, 10) === '01' && from.slice(0, 7) === to.slice(0, 7) && Number(to.slice(8, 10)) >= 28) {
    return MONTH_NAMES[Number(from.slice(5, 7)) - 1] ?? ''
  }
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${day(from)}–${day(to)} ${month(to)}`
    : `${day(from)} ${month(from)} – ${day(to)} ${month(to)}`
}

/**
 * One period on one row: the net and its return first, then how it was made.
 *
 * Rows rather than side-by-side cards: side by side on a phone, "This month"
 * broke its figure across two lines and its gains and losses across three.
 */
function RecentRow({ period }: { period: PeriodSummary }) {
  const net = Number(period.realizedJpy)
  const netTone = tone(net)
  const toneClass = netTone === 'profit' ? styles.profit : netTone === 'loss' ? styles.loss : undefined

  return (
    <div className={styles.recentRow}>
      <div className={styles.recentHead}>
        <span className={styles.recentLabel}>{period.label}</span>
        <span className={styles.recentRange}>{rangeLabel(period.from, period.to)}</span>
      </div>

      {period.tradeCount === 0 ? (
        <p className={styles.recentEmpty}>No closes</p>
      ) : (
        <>
          <div className={styles.recentNetRow}>
            <span className={styles.recentFigure}>
              <span className={cx(styles.recentNet, toneClass)}>{yenSigned(net)}</span>
              {period.returnPct != null ? (
                <span className={cx(styles.recentPct, toneClass)}>{pctSigned(period.returnPct)}</span>
              ) : null}
            </span>
            <span className={styles.recentCount}>
              {period.tradeCount} close{period.tradeCount === 1 ? '' : 's'} · {period.winCount} won ·{' '}
              {period.lossCount} lost
            </span>
          </div>
          <div className={styles.recentDetail}>
            Gains {yen(period.grossProfitJpy)} · Losses {yen(period.grossLossJpy)}
          </div>
          <MarketInline split={period.markets} className={styles.recentSplit} />
        </>
      )}
    </div>
  )
}

/**
 * Gains and losses as two lengths of one bar.
 *
 * The same net can come from ¥4M won and ¥2.5M lost or from ¥1.6M won and
 * nothing lost; the bar shows which at a glance, the figures beneath say it.
 */
function GainLossBar({ gains, losses }: { gains: string; losses: string }) {
  const won = Number(gains)
  const lost = Number(losses)
  const total = won + lost
  if (total <= 0) return null
  return (
    <div className={styles.split}>
      <div className={styles.splitTrack} aria-hidden="true">
        <span className={styles.splitGain} style={{ width: `${String((won / total) * 100)}%` }} />
        <span className={styles.splitLoss} />
      </div>
      <div className={styles.splitLegend}>
        <span>
          <span className={styles.splitLabel}>Gains</span> {yen(gains)}
        </span>
        <span>
          <span className={styles.splitLabel}>Losses</span> {yen(losses)}
        </span>
      </div>
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
    const monthName = (month: string | undefined) =>
      month ? `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}` : ''

    return {
      slice,
      canGoBack: start > 0,
      canGoForward: offset > 0,
      offset,
      label:
        slice.length === 0
          ? ''
          : slice.length === 1
            ? monthName(slice[0]?.month)
            : `${monthName(slice[0]?.month)} – ${monthName(slice.at(-1)?.month)}`,
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

  return (
    <>
      <PageHeader
        title="Dashboard"
        meta={`${String(d.tradeCount)} trades · ${String(d.openPositions)} open position${d.openPositions === 1 ? '' : 's'}`}
        filter={<AccountFilterControl value={account} onChange={setAccount} />}
      />

      <div className={styles.results}>
        <HeroStat
          label="Realized P&L · all time"
          value={yenSigned(d.realizedJpy)}
          tone={tone(realized)}
          context="In yen, currency moves included"
          aside={
            d.equityCurve.length >= 2 ? (
              <EquitySparkline points={d.equityCurve} tone={tone(realized)} height={isMobile ? 64 : 96} />
            ) : undefined
          }
        >
          <GainLossBar gains={d.grossProfitJpy} losses={d.grossLossJpy} />
          <MarketBreakdown split={d.markets} currencyEffectJpy={d.fxEffectJpy} />
        </HeroStat>
        <div className={styles.recent}>
          <RecentRow period={d.week} />
          <RecentRow period={d.month} />
        </div>
      </div>

      <Section title="Performance" description="Every close to date, by trade date">
        <div className={styles.tiles}>
          <Stat
            label="Win rate"
            value={pct(d.winRate)}
            hint="Share of closes that made money"
            meter={d.winRate ?? undefined}
          />
          <Stat
            label="Profit factor"
            value={d.profitFactor == null ? '—' : `${ratio(d.profitFactor)}×`}
            hint={
              d.profitFactor == null
                ? 'No losing closes yet'
                : `¥${ratio(d.profitFactor)} gained per ¥1 lost · above 1.0 is profitable`
            }
            meter={profitFactorMeter}
          />
          <Stat
            label="Max drawdown"
            value={yenSigned(-Number(d.maxDrawdownJpy))}
            tone="loss"
            hint="Deepest fall from a running peak"
            meter={maxDrawdownMeter}
          />
          <Stat
            label="US currency effect"
            value={d.fxShare == null ? '—' : yenSigned(d.fxEffectJpy)}
            tone={d.fxShare == null ? undefined : tone(d.fxEffectJpy)}
            hint={
              d.fxShare == null
                ? 'No US closes yet'
                : `Of US closes · share prices ${yenSigned(d.stockEffectJpy)}`
            }
            meter={d.fxShare ?? undefined}
          />
        </div>
      </Section>

      <div className={styles.capitalRow}>
        <section className={styles.capital} aria-labelledby="capital-title">
          <h2 id="capital-title" className={styles.capitalTitle}>
            Capital
          </h2>
          <dl className={styles.capitalFigures}>
            <div className={styles.capitalFigure}>
              <dt>Invested at cost</dt>
              <dd>{yen(d.investedAtCostJpy)}</dd>
            </div>
            <div className={styles.capitalFigure}>
              <dt>Open positions</dt>
              <dd>{d.openPositions}</dd>
            </div>
          </dl>
          <Link
            to="/positions"
            search={{
              sortBy: 'marketValueJpy',
              sortDir: 'desc',
              scope: account === 'ALL' ? undefined : account,
            }}
            className={styles.capitalLink}
          >
            View positions →
          </Link>
        </section>

        {d.nisa ? <NisaQuotaCard nisa={d.nisa} /> : null}
        {d.taxYear ? <TaxYearCard tax={d.taxYear} /> : null}
      </div>

      <Section
        title="Monthly realized P&L"
        description={
          isMobile
            ? 'Right of zero in profitable months, left in losing ones.'
            : 'Above the line in profitable months, below it in losing ones. The % is the return on what closed that month.'
        }
      >
        {isMobile ? (
          <MonthlyZeroBars data={view.slice} nav={nav} />
        ) : (
          <MonthlyPnlChart data={view.slice} nav={nav} />
        )}
      </Section>
    </>
  )
}
