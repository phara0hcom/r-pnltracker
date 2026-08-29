import { createFileRoute } from '@tanstack/react-router'
import styles from './stats.module.scss'
import { ACCOUNT_LABEL, ASSET_LABEL, days, pct, ratio, tone, yen, yenSigned } from '~/components/format'
import { Empty, PageHeader, Section, Stat, StatGrid, Table } from '~/components/screen'
import { AttrBar } from '~/components/stats/AttrBar'
import { CorrelationTable } from '~/components/stats/CorrelationTable'
import { AccountFilterControl } from '~/components/ui/AccountFilterControl'
import { useAccountFilter } from '~/components/ui/AccountSwitch'
import { RevealableText } from '~/components/ui/RevealableText'
import { accountScopeSchema } from '~/lib/accountScope'
import { getStats } from '~/server/screens'

export const Route = createFileRoute('/_authed/stats')({
  validateSearch: accountScopeSchema,
  loaderDeps: ({ search }) => ({ account: search.scope ?? 'ALL' }),
  loader: ({ deps }) => getStats({ data: { account: deps.account } }),
  component: Stats,
})

function Stats() {
  const d = Route.useLoaderData()
  const [account, setAccount] = useAccountFilter()
  const hasJournal = d.moodCorrelation.length > 0 || d.motivationCorrelation.length > 0

  return (
    <>
      <PageHeader
        title="Stats"
        meta={`${String(d.tradeCount)} closed trades · ${String(d.winCount)}W / ${String(d.lossCount)}L`}
      >
        <AccountFilterControl value={account} onChange={setAccount} />
      </PageHeader>

      <StatGrid>
        <Stat label="Win rate" value={pct(d.winRate)} />
        <Stat label="Net P&L" value={yen(d.netPnl)} tone={tone(d.netPnl)} />
        <Stat label="Avg win" value={yen(d.avgWin)} tone="profit" />
        <Stat label="Avg loss" value={yen(d.avgLoss)} tone="loss" />
        <Stat
          label="Payoff ratio"
          value={ratio(d.payoffRatio)}
          hint="avg win ÷ avg loss"
        />
        <Stat label="Profit factor" value={ratio(d.profitFactor)} hint="gains ÷ losses" />
        <Stat
          label="Max drawdown"
          value={yen(d.maxDrawdown)}
          tone="loss"
          hint={pct(d.maxDrawdownPct)}
        />
        <Stat
          label="Streaks"
          value={`${String(d.longestWinStreak)}W / ${String(d.longestLossStreak)}L`}
          hint="longest consecutive"
        />
        <Stat
          label="Holding period"
          value={days(d.avgHoldingDays)}
          hint={`median ${days(d.medianHoldingDays)}`}
        />
      </StatGrid>

      <Section
        title="US currency attribution"
        description="Splits US realized P&L into share-price movement versus yen movement. The three components sum exactly to the total; the third absorbs costs and the averaging residual on positions built at more than one rate."
      >
        <div className={styles.attribution}>
          <AttrBar label="Stock movement" value={d.fx.stockEffect} total={d.fx.total} />
          <AttrBar label="Yen movement" value={d.fx.fxEffect} total={d.fx.total} />
          <AttrBar label="Costs + residual" value={d.fx.costEffect} total={d.fx.total} />
          <div className={styles.attrTotal}>
            <span>Total US realized</span>
            <strong className={tone(d.fx.total)}>{yenSigned(d.fx.total)}</strong>
          </div>
        </div>
        <p className={styles.note}>
          {d.fx.closes} closes · FX explains {pct(d.fx.fxShare)} of gross movement · average entry
          rate {d.fx.avgEntryFx}, exit {d.fx.avgExitFx}
        </p>
      </Section>

      <Section title="By account">
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
                <td>{ACCOUNT_LABEL[group.key] ?? group.key}</td>
                <td data-numeric>{group.tradeCount}</td>
                <td data-numeric>{pct(group.winRate, 0)}</td>
                <td data-numeric className={tone(group.netPnl)}>{yen(group.netPnl)}</td>
                <td data-numeric>{ratio(group.profitFactor)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section title="By asset class">
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
                <td>{ASSET_LABEL[group.key] ?? group.key}</td>
                <td data-numeric>{group.tradeCount}</td>
                <td data-numeric>{pct(group.winRate, 0)}</td>
                <td data-numeric className={tone(group.netPnl)}>{yen(group.netPnl)}</td>
                <td data-numeric>{ratio(group.profitFactor)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section
        title="Mood and motivation"
        description="Realized P&L on days you journalled, bucketed by the score you gave that day."
      >
        {!hasJournal ? (
          <Empty>
            No journal entries yet. Add notes with a mood and motivation score on the Calendar, and
            this will show whether your results track how you felt.
          </Empty>
        ) : (
          <div className={styles.correlations}>
            <CorrelationTable
              caption="By mood"
              rows={d.moodCorrelation.map((row) => ({ score: row.mood, ...row }))}
            />
            <CorrelationTable
              caption="By motivation"
              rows={d.motivationCorrelation.map((row) => ({ score: row.motivation, ...row }))}
            />
          </div>
        )}
      </Section>

      <Section title="By instrument" description="Ranked by contribution.">
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
                  {/* A fund's symbol is its name, so the second line would
                      repeat the first, truncated identically — and the reveal
                      moves up to whichever line carries the name. */}
                  {row.name === row.symbol ? (
                    <RevealableText as="strong" text={row.symbol} className={styles.instrument} />
                  ) : (
                    <>
                      <strong className={styles.instrument}>{row.symbol}</strong>
                      <RevealableText as="div" text={row.name} className={styles.subName} />
                    </>
                  )}
                </td>
                <td data-numeric>{row.tradeCount}</td>
                <td data-numeric>{pct(row.winRate, 0)}</td>
                <td data-numeric className={tone(row.netPnl)}>{yen(row.netPnl)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </>
  )
}
