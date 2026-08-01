import { createFileRoute } from '@tanstack/react-router'
import styles from './stats.module.scss'
import { ACCOUNT_LABEL, ASSET_LABEL, days, pct, ratio, tone, yen, yenSigned } from '~/components/format'
import { Empty, PageHeader, Section, Stat, StatGrid, Table } from '~/components/Screen'
import { cx } from '~/lib/cx'
import { getStats } from '~/server/screens'

export const Route = createFileRoute('/_authed/stats')({
  loader: () => getStats(),
  component: Stats,
})

function Stats() {
  const d = Route.useLoaderData()
  const hasJournal = d.moodCorrelation.length > 0 || d.motivationCorrelation.length > 0

  return (
    <>
      <PageHeader
        title="Stats"
        meta={`${String(d.tradeCount)} closed trades · ${String(d.winCount)}W / ${String(d.lossCount)}L`}
      />

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
        description="Splits US realized P&L into share-price movement versus yen movement. The two components sum exactly to the total — there is no unexplained residual."
      >
        <div className={styles.attribution}>
          <AttrBar label="Stock movement" value={d.fx.stockEffect} total={d.fx.total} />
          <AttrBar label="Yen movement" value={d.fx.fxEffect} total={d.fx.total} />
          <AttrBar label="Fees + rounding" value={d.fx.costEffect} total={d.fx.total} />
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
            {d.byAccount.map((g) => (
              <tr key={g.key}>
                <td>{ACCOUNT_LABEL[g.key] ?? g.key}</td>
                <td data-numeric>{g.tradeCount}</td>
                <td data-numeric>{pct(g.winRate, 0)}</td>
                <td data-numeric className={tone(g.netPnl)}>{yen(g.netPnl)}</td>
                <td data-numeric>{ratio(g.profitFactor)}</td>
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
            {d.byAssetClass.map((g) => (
              <tr key={g.key}>
                <td>{ASSET_LABEL[g.key] ?? g.key}</td>
                <td data-numeric>{g.tradeCount}</td>
                <td data-numeric>{pct(g.winRate, 0)}</td>
                <td data-numeric className={tone(g.netPnl)}>{yen(g.netPnl)}</td>
                <td data-numeric>{ratio(g.profitFactor)}</td>
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
              rows={d.moodCorrelation.map((r) => ({ score: r.mood, ...r }))}
            />
            <CorrelationTable
              caption="By motivation"
              rows={d.motivationCorrelation.map((r) => ({ score: r.motivation, ...r }))}
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
            {d.symbols.map((r) => (
              <tr key={r.symbol}>
                <td>
                  <strong>{r.symbol}</strong>
                  <div className={styles.subName}>{r.name}</div>
                </td>
                <td data-numeric>{r.tradeCount}</td>
                <td data-numeric>{pct(r.winRate, 0)}</td>
                <td data-numeric className={tone(r.netPnl)}>{yen(r.netPnl)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </>
  )
}

/** Signed bar — width is share of the largest component, so sign stays readable. */
function AttrBar({ label, value, total }: { label: string; value: string; total: string }) {
  const v = Number(value)
  const scale = Math.max(Math.abs(Number(total)), Math.abs(v)) || 1
  const width = (Math.abs(v) / scale) * 100
  return (
    <div className={styles.attrRow}>
      <span className={styles.attrLabel}>{label}</span>
      <div className={styles.attrTrack}>
        <div
          className={v >= 0 ? styles.attrFillPos : styles.attrFillNeg}
          style={{ width: `${String(Math.min(width, 100))}%` }}
        />
      </div>
      <span
        className={cx(
          styles.attrValue,
          tone(value) === 'profit' && styles.profit,
          tone(value) === 'loss' && styles.loss,
        )}
      >
        {yenSigned(value)}
      </span>
    </div>
  )
}

function CorrelationTable({
  caption,
  rows,
}: {
  caption: string
  rows: { score: number; days: number; totalPnl: string; avgPnl: string }[]
}) {
  return (
    <div>
      <h3 className={styles.corrTitle}>{caption}</h3>
      <Table>
        <thead>
          <tr>
            <th scope="col">Score</th>
            <th scope="col" data-numeric>Days</th>
            <th scope="col" data-numeric>Avg P&L</th>
            <th scope="col" data-numeric>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.score}>
              <td>{'★'.repeat(r.score)}<span className={styles.dim}>{'☆'.repeat(5 - r.score)}</span></td>
              <td data-numeric>{r.days}</td>
              <td data-numeric className={tone(r.avgPnl)}>{yenSigned(r.avgPnl)}</td>
              <td data-numeric className={tone(r.totalPnl)}>{yenSigned(r.totalPnl)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
