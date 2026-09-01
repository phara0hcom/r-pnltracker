import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import styles from './stats.module.scss'
import { AccountDot } from '~/components/AccountDot'
import { TradeScatter } from '~/components/charts/TradeScatter'
import { ZeroBar } from '~/components/charts/ZeroBar'
import { ACCOUNT_LABEL, ASSET_LABEL, days, pct, ratio, tone, yen, yenSigned } from '~/components/format'
import { Empty, HeroStat, PageHeader, Pagination, SegmentedTabs, Section, StatStrip, StripCell, Table } from '~/components/screen'
import { AttrBar } from '~/components/stats/AttrBar'
import { CorrelationTable } from '~/components/stats/CorrelationTable'
import { AccountFilterControl } from '~/components/ui/AccountFilterControl'
import { useAccountFilter } from '~/components/ui/AccountSwitch'
import { RevealableText } from '~/components/ui/RevealableText'
import { useIsMobile } from '~/components/ui/useIsMobile'
import { useSwipe } from '~/components/ui/useSwipe'
import { accountScopeSchema } from '~/lib/accountScope'
import { type WindowUnit, returnDomain, windowFor, windowsBack } from '~/lib/charts/tradeScatter'
import { cx } from '~/lib/cx'
import { getStats } from '~/server/screens'

export const Route = createFileRoute('/_authed/stats')({
  // The trade-distribution view and its window live in the URL for the same
  // reason the dashboard's chart window does: a particular period stays
  // shareable and survives a refresh. Optional rather than defaulted — a
  // required key would force every redirect to /stats to supply one.
  validateSearch: z
    .object({
      view: z.enum(['table', 'chart']).catch('table').optional(),
      back: z.number().int().min(0).catch(0).optional(),
      // Paging for the instrument table, named as on Trades. `.catch()` like
      // every other param here: a hand-edited URL falls back to page one
      // rather than erroring the route.
      page: z.number().int().min(1).catch(1).optional(),
      perPage: z
        .union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])
        .catch(25)
        .optional(),
    })
    .extend(accountScopeSchema.shape),
  loaderDeps: ({ search }) => ({ account: search.scope ?? 'ALL' }),
  loader: ({ deps }) => getStats({ data: { account: deps.account } }),
  component: Stats,
})

const ASSET_COLOR: Record<string, string> = {
  US_EQUITY: 'var(--color-accent)',
  JP_EQUITY: 'var(--color-specific)',
  FUND: 'var(--color-nisa-tsumitate)',
}

const TABS = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'breakdown' as const, label: 'Breakdown' },
  { id: 'trades' as const, label: 'Trades' },
  { id: 'journal' as const, label: 'Journal' },
]

/**
 * Row counts offered under the instrument table.
 *
 * Smaller than the Trades screen's: this list is one row per instrument you
 * have ever closed, which is tens of rows, not hundreds. The values have to
 * exist in the route's `perPage` union or the call below does not compile.
 */
const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const
type PerPage = (typeof PER_PAGE_OPTIONS)[number]

const VIEW_TABS = [
  { id: 'table' as const, label: 'Table' },
  { id: 'chart' as const, label: 'Chart' },
]

/**
 * How far one press of the nav moves. A month on PC and a week on SP, because
 * that is how many day columns each screen has room for — 31 columns on a
 * 390px phone would be 12px each, which is narrower than the smallest circle.
 */
const stepFor = (isMobile: boolean): WindowUnit => (isMobile ? 'week' : 'month')

function InstrumentCell({ symbol, name }: { symbol: string; name: string }) {
  return name === symbol ? (
    <RevealableText as="strong" text={symbol} className={styles.instrument} />
  ) : (
    <>
      <strong className={styles.instrument}>{symbol}</strong>
      <RevealableText as="div" text={name} className={styles.subName} />
    </>
  )
}

function Stats() {
  const d = Route.useLoaderData()
  const [account, setAccount] = useAccountFilter()
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('overview')
  const { view = 'table', back = 0, page: rawPage = 1, perPage = 25 } = Route.useSearch()
  const navigate = Route.useNavigate()
  const hasJournal = d.moodCorrelation.length > 0 || d.motivationCorrelation.length > 0

  const unit = stepFor(isMobile)

  /**
   * The trade-distribution window, and the two scales the chart is drawn on.
   *
   * The whole history is already in the loader payload, so paging costs no
   * round-trip — the same trade the dashboard chart makes. Both scales are
   * derived from *every* close rather than the visible ones: a window-at-a-time
   * scale would draw a quiet week's ¥3,000 win the same size as a busy month's
   * ¥300,000 one and destroy the comparison paging exists to make.
   *
   * Anchored to the last close rather than to today. A portfolio whose most
   * recent sale was in March should open on March, not on an empty August.
   */
  const distribution = useMemo(() => {
    const anchor = d.closes.at(-1)?.date
    if (anchor == null) return null

    const maxBack = windowsBack(unit, d.closes[0]?.date ?? anchor, anchor)
    // Clamped rather than trusted: `back` comes from the URL, and a stale
    // bookmark from the PC (months) lands here as a week index on a phone.
    const offset = Math.min(Math.max(back, 0), maxBack)
    const window = windowFor(unit, anchor, offset)

    return {
      window,
      offset,
      maxBack,
      inWindow: d.closes.filter((close) => close.date >= window.start && close.date <= window.end),
      domain: returnDomain(
        d.closes.map((close) => close.returnPct).filter((value): value is number => value != null),
      ),
      maxMagnitude: Math.max(0, ...d.closes.map((close) => Math.abs(Number(close.realizedJpy)))),
    }
  }, [d.closes, back, unit])

  /**
   * Rewrites one search param without disturbing the rest of the screen.
   *
   * Merged onto `prev` rather than replaced: the object form drops the whole
   * search record, which would silently reset the account switch every time you
   * paged — the bug the dashboard chart already hit.
   *
   * `resetScroll: false` because none of these controls is a new destination.
   * The router scrolls to the top of the page on every navigation by default,
   * so without it, flipping the Table/Chart switch or stepping a page threw the
   * reader back to the page header — away from the control they just pressed.
   *
   * `replace: true` for the same reason: refining one view should not stack a
   * history entry per press, so Back leaves the screen rather than walking
   * through every toggle.
   */
  const setSearch = (patch: Partial<ReturnType<typeof Route.useSearch>>) => {
    void navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
    })
  }

  const shift = (delta: number) => {
    if (distribution == null) return
    setSearch({ back: Math.min(Math.max(distribution.offset + delta, 0), distribution.maxBack) })
  }

  const setView = (next: (typeof VIEW_TABS)[number]['id']) => {
    setSearch({ view: next })
  }

  const setSymbolPage = (next: number) => {
    setSearch({ page: next })
  }

  // Landing on page 4 of a 25-row view after switching to 100 rows would show
  // rows 301+ of a list that no longer has them, so the size change restarts.
  const setPerPage = (size: PerPage) => {
    setSearch({ perPage: size, page: 1 })
  }

  // Swiping left pulls the next period in from the right, which is the
  // direction every calendar on the phone already moves.
  const swipe = useSwipe({
    onLeft: () => {
      shift(-1)
    },
    onRight: () => {
      shift(1)
    },
    enabled: isMobile,
  })

  // Bars scale to the largest *component*, not the signed total — the three
  // parts can offset each other, so scaling by the total distorts them.
  const attrScale =
    Math.max(Math.abs(Number(d.fx.stockEffect)), Math.abs(Number(d.fx.fxEffect)), Math.abs(Number(d.fx.costEffect))) ||
    1

  // Extents span *every* instrument, not the visible page — the SP bars would
  // otherwise rescale as you page and a rank-30 row would draw as wide as the
  // top contributor. Same reason `ZeroBar` takes dataset-wide maxima.
  const symbolValues = d.symbols.map((row) => Number(row.netPnl))
  const symbolMaxPos = Math.max(0, ...symbolValues)
  const symbolMaxNeg = Math.abs(Math.min(0, ...symbolValues))

  const symbolPageCount = Math.max(1, Math.ceil(d.symbols.length / perPage))
  // Clamped rather than 404: narrowing the account switch while on page 4
  // should land on the last real page, not an empty one. Matches Trades.
  const symbolPage = Math.min(Math.max(rawPage, 1), symbolPageCount)
  const symbolRows = useMemo(
    () => d.symbols.slice((symbolPage - 1) * perPage, symbolPage * perPage),
    [d.symbols, symbolPage, perPage],
  )

  /*
   * Shown whenever the list is longer than the smallest page size, not merely
   * when the *current* size overflows.
   *
   * Keying it on `pageCount > 1` would be a trap: 30 instruments at 25 a page
   * shows the control, choosing 50 collapses it to one page, and the control
   * that would put it back has just disappeared.
   */
  const symbolPagination =
    d.symbols.length > PER_PAGE_OPTIONS[0] ? (
      <Pagination
        label="Instrument pagination"
        page={symbolPage}
        pageCount={symbolPageCount}
        perPage={perPage}
        perPageOptions={PER_PAGE_OPTIONS}
        total={d.symbols.length}
        onPage={(next) => {
          setSymbolPage(next)
        }}
        onPerPage={(size) => {
          setPerPage(size)
        }}
      />
    ) : null

  const attribution = (
    <>
      <AttrBar label="Stock movement" value={d.fx.stockEffect} scale={attrScale} />
      <AttrBar label="Yen movement" value={d.fx.fxEffect} scale={attrScale} />
      <AttrBar label="Costs + residual" value={d.fx.costEffect} scale={attrScale} />
      <div className={styles.attrTotal}>
        <span>Total US realized</span>
        <strong className={tone(d.fx.total)}>{yenSigned(d.fx.total)}</strong>
      </div>
      <p className={styles.note}>
        {d.fx.closes} closes · FX explains {pct(d.fx.fxShare)} of gross movement · average entry
        rate {d.fx.avgEntryFx}, exit {d.fx.avgExitFx}
      </p>
    </>
  )

  const byAccountTable = (
    <Table>
      <thead>
        <tr>
          <th scope="col">Account</th>
          <th scope="col" data-numeric>Closes</th>
          <th scope="col" data-numeric>Win rate</th>
          <th scope="col" data-numeric>Net P&L</th>
          <th scope="col" data-numeric>Profit factor</th>
        </tr>
      </thead>
      <tbody>
        {d.byAccount.map((group) => (
          <tr key={group.key}>
            <td>
              <span className={styles.dotCell}>
                <AccountDot accountType={group.key} />
                {ACCOUNT_LABEL[group.key] ?? group.key}
              </span>
            </td>
            <td data-numeric>{group.tradeCount}</td>
            <td data-numeric>{pct(group.winRate, 0)}</td>
            <td data-numeric className={tone(group.netPnl)}>{yen(group.netPnl)}</td>
            <td data-numeric>{ratio(group.profitFactor)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )

  const byAssetTable = (
    <Table>
      <thead>
        <tr>
          <th scope="col">Class</th>
          <th scope="col" data-numeric>Closes</th>
          <th scope="col" data-numeric>Win rate</th>
          <th scope="col" data-numeric>Net P&L</th>
          <th scope="col" data-numeric>Profit factor</th>
        </tr>
      </thead>
      <tbody>
        {d.byAssetClass.map((group) => (
          <tr key={group.key}>
            <td>
              <span className={styles.dotCell}>
                <span className={styles.classDot} style={{ backgroundColor: ASSET_COLOR[group.key] ?? 'var(--color-text-subtle)' }} />
                {ASSET_LABEL[group.key] ?? group.key}
              </span>
            </td>
            <td data-numeric>{group.tradeCount}</td>
            <td data-numeric>{pct(group.winRate, 0)}</td>
            <td data-numeric className={tone(group.netPnl)}>{yen(group.netPnl)}</td>
            <td data-numeric>{ratio(group.profitFactor)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )

  const byInstrumentTable = (
    <Table>
      <thead>
        <tr>
          <th scope="col">Instrument</th>
          <th scope="col" data-numeric>Closes</th>
          <th scope="col" data-numeric>Win rate</th>
          <th scope="col" data-numeric>Net P&L</th>
        </tr>
      </thead>
      <tbody>
        {symbolRows.map((row) => (
          <tr key={row.symbol}>
            <td>
              <InstrumentCell symbol={row.symbol} name={row.name} />
            </td>
            <td data-numeric>{row.tradeCount}</td>
            <td data-numeric>{pct(row.winRate, 0)}</td>
            <td data-numeric className={tone(row.netPnl)}>{yen(row.netPnl)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )

  const closeRows = distribution?.inWindow ?? []
  const periodLabel = distribution?.window.label ?? ''

  const closesTable = (
    <Table caption={`Closes in ${periodLabel}`}>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Instrument</th>
          <th scope="col">Account</th>
          <th scope="col" data-numeric>Held</th>
          <th scope="col" data-numeric>Return</th>
          <th scope="col" data-numeric>Net P&L</th>
        </tr>
      </thead>
      <tbody>
        {closeRows.map((close, index) => (
          <tr key={`${close.date}-${close.symbol}-${close.accountType}-${String(index)}`}>
            <td className={styles.dateCell}>{close.date}</td>
            <td>
              <InstrumentCell symbol={close.symbol} name={close.name} />
            </td>
            <td>
              <span className={styles.dotCell}>
                <AccountDot accountType={close.accountType} />
                {ACCOUNT_LABEL[close.accountType] ?? close.accountType}
              </span>
            </td>
            <td data-numeric>{days(close.holdingDays)}</td>
            <td data-numeric className={tone(close.returnPct)}>{pct(close.returnPct)}</td>
            <td data-numeric className={tone(close.realizedJpy)}>{yenSigned(close.realizedJpy)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )

  const spClosesList = (
    <div className={styles.spCloses}>
      {closeRows.map((close, index) => (
        <div
          key={`${close.date}-${close.symbol}-${close.accountType}-${String(index)}`}
          className={styles.spCloseRow}
        >
          <div className={styles.spCloseHead}>
            <span className={styles.spCloseName}>{close.symbol}</span>
            <span className={cx(styles.spCloseNet, tone(close.realizedJpy))}>
              {yenSigned(close.realizedJpy)}
            </span>
          </div>
          <div className={styles.spCloseMeta}>
            <span>{close.date}</span>
            <span>{ACCOUNT_LABEL[close.accountType] ?? close.accountType}</span>
            <span>held {days(close.holdingDays)}</span>
            <span className={cx(styles.spCloseReturn, tone(close.returnPct))}>
              {pct(close.returnPct)}
            </span>
          </div>
        </div>
      ))}
    </div>
  )

  const viewSwitch = (
    <div className={styles.viewSwitch}>
      <SegmentedTabs tabs={VIEW_TABS} active={view} onChange={setView} label="Trade distribution view" />
    </div>
  )

  const distributionBody = distribution == null ? (
    <Empty>
      No closed trades yet. Once a position is sold it lands here — as a row in the table, and as a
      circle on the chart.
    </Empty>
  ) : (
    <>
      <div className={styles.periodNav}>
        {/* Announced on change: the nav buttons keep focus while everything
            behind them is replaced, so without this a screen-reader user gets
            no signal that the period moved. */}
        <span className={styles.periodLabel} aria-live="polite">{distribution.window.label}</span>
        <div className={styles.periodButtons}>
          <button
            type="button"
            className={styles.periodButton}
            onClick={() => {
              shift(1)
            }}
            disabled={distribution.offset >= distribution.maxBack}
            aria-label={unit === 'week' ? 'Show the previous week' : 'Show the previous month'}
          >
            ←
          </button>
          <button
            type="button"
            className={styles.periodButton}
            onClick={() => {
              shift(-1)
            }}
            disabled={distribution.offset === 0}
            aria-label={unit === 'week' ? 'Show the next week' : 'Show the next month'}
          >
            →
          </button>
          <button
            type="button"
            className={styles.periodButton}
            onClick={() => {
              setSearch({ back: 0 })
            }}
            disabled={distribution.offset === 0}
          >
            Latest
          </button>
        </div>
      </div>

      {view === 'chart' ? (
        <div className={styles.swipeArea} {...swipe}>
          <TradeScatter
            trades={distribution.inWindow}
            days={distribution.window.days}
            domain={distribution.domain}
            maxMagnitude={distribution.maxMagnitude}
            compact={isMobile}
          />
          {isMobile ? (
            <p className={styles.swipeHint}>Swipe the chart to change week.</p>
          ) : null}
        </div>
      ) : closeRows.length === 0 ? (
        <Empty>No closes in {periodLabel}.</Empty>
      ) : isMobile ? (
        spClosesList
      ) : (
        closesTable
      )}
    </>
  )

  const journal = !hasJournal ? (
    <Empty>
      No journal entries yet. Add notes with a mood and motivation score on the Calendar, and this
      will show whether your results track how you felt.
    </Empty>
  ) : (
    <div className={styles.correlations}>
      <CorrelationTable caption="By mood" rows={d.moodCorrelation.map((row) => ({ score: row.mood, ...row }))} />
      <CorrelationTable
        caption="By motivation"
        rows={d.motivationCorrelation.map((row) => ({ score: row.motivation, ...row }))}
      />
    </div>
  )

  return (
    <>
      <PageHeader
        title="Stats"
        meta={`${String(d.tradeCount)} closed trades · ${String(d.winCount)}W / ${String(d.lossCount)}L`}
      >
        <AccountFilterControl value={account} onChange={setAccount} />
      </PageHeader>

      <div className={styles.heroRow}>
        <HeroStat
          label="Net P&L"
          value={yen(d.netPnl)}
          tone={tone(d.netPnl)}
          context={`${pct(d.winRate)} win rate · ${String(d.winCount)}W / ${String(d.lossCount)}L`}
        />
        <StatStrip>
          <StripCell label="Win rate" value={pct(d.winRate)} hint={`${String(d.winCount)}W / ${String(d.lossCount)}L`} />
          <StripCell label="Avg win / loss" value={`${yen(d.avgWin)} / ${yen(d.avgLoss)}`} hint={`payoff ${ratio(d.payoffRatio)}`} />
          <StripCell label="Profit factor" value={ratio(d.profitFactor)} hint="gains ÷ losses" />
          <StripCell label="Max drawdown" value={yen(d.maxDrawdown)} tone="loss" hint={pct(d.maxDrawdownPct)} />
          <StripCell label="Streaks" value={`${String(d.longestWinStreak)}W / ${String(d.longestLossStreak)}L`} hint="longest run" />
          <StripCell label="Holding period" value={days(d.avgHoldingDays)} hint={`median ${days(d.medianHoldingDays)}`} />
        </StatStrip>
      </div>

      {isMobile ? (
        <>
          <SegmentedTabs tabs={TABS} active={tab} onChange={setTab} label="Section" />

          {tab === 'overview' ? (
            <dl className={styles.spStats}>
              <div className={styles.spRow}>
                <dt>Avg win</dt>
                <dd className={styles.profit}>{yen(d.avgWin)}</dd>
              </div>
              <div className={styles.spRow}>
                <dt>Avg loss</dt>
                <dd className={styles.loss}>{yen(d.avgLoss)}</dd>
              </div>
              <div className={styles.spRow}>
                <dt>
                  Payoff ratio <span className={styles.spHint}>win ÷ loss</span>
                </dt>
                <dd>{ratio(d.payoffRatio)}</dd>
              </div>
              <div className={styles.spRow}>
                <dt>Profit factor</dt>
                <dd>{ratio(d.profitFactor)}</dd>
              </div>
              <div className={styles.spRow}>
                <dt>
                  Max drawdown <span className={styles.spHint}>{pct(d.maxDrawdownPct)}</span>
                </dt>
                <dd className={styles.loss}>{yen(d.maxDrawdown)}</dd>
              </div>
              <div className={styles.spRow}>
                <dt>
                  Streaks <span className={styles.spHint}>longest</span>
                </dt>
                <dd>{d.longestWinStreak}W / {d.longestLossStreak}L</dd>
              </div>
              <div className={styles.spRow}>
                <dt>
                  Holding period <span className={styles.spHint}>median {days(d.medianHoldingDays)}</span>
                </dt>
                <dd>{days(d.avgHoldingDays)}</dd>
              </div>
            </dl>
          ) : null}

          {tab === 'breakdown' ? (
            <>
              <h2 className={styles.spSectionTitle}>US currency attribution</h2>
              <p className={styles.spSectionDesc}>
                Share-price movement versus yen movement. The three sum to the total.
              </p>
              <div className={styles.spAttr}>
                {[
                  { label: 'Stock movement', value: d.fx.stockEffect },
                  { label: 'Yen movement', value: d.fx.fxEffect },
                  { label: 'Costs + residual', value: d.fx.costEffect },
                ].map((component) => {
                  const v = Number(component.value)
                  const width = attrScale > 0 ? Math.min((Math.abs(v) / attrScale) * 100, 100) : 0
                  return (
                    <div key={component.label} className={styles.spAttrRow}>
                      <span className={styles.spAttrHead}>
                        <span className={styles.spAttrLabel}>{component.label}</span>
                        <span className={cx(styles.spAttrValue, tone(v))}>{yenSigned(v)}</span>
                      </span>
                      <div className={styles.spAttrTrack}>
                        <div
                          className={v >= 0 ? styles.spAttrFillPos : styles.spAttrFillNeg}
                          style={{ width: `${String(width)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className={styles.attrTotal}>
                <span>Total US realized</span>
                <strong className={tone(d.fx.total)}>{yenSigned(d.fx.total)}</strong>
              </div>

              <h2 className={styles.spSectionTitle}>By account</h2>
              {byAccountTable}
              <h2 className={styles.spSectionTitle}>By asset class</h2>
              {byAssetTable}

              <h2 className={styles.spSectionTitle}>Top contributors</h2>
              <div className={styles.spSymbols}>
                {symbolRows.map((row) => (
                  <div key={row.symbol} className={styles.spSymbolRow}>
                    <div className={styles.spSymbolHead}>
                      <span className={styles.spSymbolName}>{row.symbol}</span>
                      <span className={cx(styles.spSymbolNet, tone(row.netPnl))}>{yenSigned(row.netPnl)}</span>
                    </div>
                    <div className={styles.spSymbolBar}>
                      <span className={styles.spSymbolCloses}>{row.tradeCount} closes</span>
                      <div className={styles.spSymbolTrack}>
                        <ZeroBar value={Number(row.netPnl)} maxPos={symbolMaxPos} maxNeg={symbolMaxNeg} size="compact" />
                      </div>
                      <span className={styles.spSymbolWin}>{pct(row.winRate, 0)}</span>
                    </div>
                  </div>
                ))}
              </div>
              {symbolPagination}
            </>
          ) : null}

          {tab === 'trades' ? (
            <>
              <div className={styles.spDistHead}>
                <h2 className={styles.spSectionTitle}>Trade distribution</h2>
                {viewSwitch}
              </div>
              <p className={styles.spSectionDesc}>
                {view === 'chart'
                  ? 'One circle per close: the day it closed across, its return on cost up, and the yen size of the result as the circle area.'
                  : 'Every close in the week, with the return measured against the cost basis of the units sold.'}
              </p>
              {distributionBody}
            </>
          ) : null}

          {tab === 'journal' ? journal : null}
        </>
      ) : (
        <>
          <div className={styles.twoCol}>
            <Section
              title="US currency attribution"
              description="Splits US realized P&L into share-price movement versus yen movement. The three components sum exactly to the total; the third absorbs costs and the averaging residual on positions built at more than one rate."
            >
              <div className={styles.attribution}>{attribution}</div>
            </Section>

            <Section
              title="Mood and motivation"
              description="Realized P&L on days you journalled, bucketed by the score you gave that day."
            >
              {journal}
            </Section>
          </div>

          <div className={styles.twoCol}>
            <Section title="By account">{byAccountTable}</Section>
            <Section title="By asset class">{byAssetTable}</Section>
          </div>

          <Section title="By instrument" description="Ranked by contribution.">
            {byInstrumentTable}
            {symbolPagination}
          </Section>

          <Section
            title="Trade distribution"
            description={
              view === 'chart'
                ? 'One circle per close: the day it closed across, its return on cost up, and the yen size of the gain or loss as the circle area. Return and contribution are not the same thing — a small position can post a large percentage — and the two encodings are what separate them.'
                : 'Every close in the month, with the return measured against the weighted-average cost of the units sold. There is no link back to an individual buy: 移動平均法 pools units, so a sale closes against the pool.'
            }
            actions={viewSwitch}
          >
            {distributionBody}
          </Section>
        </>
      )}
    </>
  )
}
