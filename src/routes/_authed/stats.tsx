import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import styles from './stats.module.scss'
import { AccountDot } from '~/components/AccountDot'
import { ZeroBar } from '~/components/charts/ZeroBar'
import { ACCOUNT_LABEL, ASSET_LABEL, days, pct, ratio, tone, yen, yenSigned } from '~/components/format'
import { Empty, HeroStat, PageHeader, SegmentedTabs, Section, StatStrip, StripCell, Table } from '~/components/screen'
import { AttrBar } from '~/components/stats/AttrBar'
import { CorrelationTable } from '~/components/stats/CorrelationTable'
import { AccountFilterControl } from '~/components/ui/AccountFilterControl'
import { useAccountFilter } from '~/components/ui/AccountSwitch'
import { RevealableText } from '~/components/ui/RevealableText'
import { useIsMobile } from '~/components/ui/useIsMobile'
import { accountScopeSchema } from '~/lib/accountScope'
import { cx } from '~/lib/cx'
import { getStats } from '~/server/screens'

export const Route = createFileRoute('/_authed/stats')({
  validateSearch: accountScopeSchema,
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
  { id: 'journal' as const, label: 'Journal' },
]

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
  const hasJournal = d.moodCorrelation.length > 0 || d.motivationCorrelation.length > 0

  // Bars scale to the largest *component*, not the signed total — the three
  // parts can offset each other, so scaling by the total distorts them.
  const attrScale =
    Math.max(Math.abs(Number(d.fx.stockEffect)), Math.abs(Number(d.fx.fxEffect)), Math.abs(Number(d.fx.costEffect))) ||
    1

  const symbolValues = d.symbols.map((row) => Number(row.netPnl))
  const symbolMaxPos = Math.max(0, ...symbolValues)
  const symbolMaxNeg = Math.abs(Math.min(0, ...symbolValues))

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
        {d.symbols.map((row) => (
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
                {d.symbols.map((row) => (
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
          </Section>
        </>
      )}
    </>
  )
}
