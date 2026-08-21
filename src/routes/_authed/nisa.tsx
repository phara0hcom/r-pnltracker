import { createFileRoute } from '@tanstack/react-router'
import styles from './nisa.module.scss'
import { pct, yen } from '~/components/format'
import { Meter, PageHeader, Section, Stat, StatGrid, Table } from '~/components/screen'
import { getNisa } from '~/server/screens'

export const Route = createFileRoute('/_authed/nisa')({
  loader: () => getNisa(),
  component: Nisa,
})

const FRAME_LABEL = {
  NISA_GROWTH: '成長投資枠',
  NISA_TSUMITATE: 'つみたて投資枠',
} as const

function Nisa() {
  const d = Route.useLoaderData()
  const years = [...new Set(d.annual.map((frame) => frame.year))].sort((a, b) => b - a)

  return (
    <>
      <PageHeader
        title="NISA"
        meta={`非課税保有限度額 · ${pct(d.lifetimeUtilization)} of ¥18,000,000 used (簿価ベース)`}
      />

      <StatGrid>
        <Stat label="Lifetime used" value={yen(d.lifetimeUsed)} hint="at acquisition cost" />
        <Stat label="Headroom" value={yen(d.lifetimeRemaining)} tone="profit" />
        <Stat
          label="成長投資枠 held"
          value={yen(d.growthUsed)}
          hint={`of ¥12,000,000 sub-cap`}
        />
        <Stat
          label={`Restoring ${d.restorationDate}`}
          value={yen(d.pendingRestoration)}
          hint="from this year's sales"
        />
      </StatGrid>

      <Section
        title="Lifetime limit"
        description="Measured at book value, so gains never consume quota. Selling frees the acquisition cost back — but only from January of the following year."
      >
        <div className={styles.meters}>
          <Meter
            label="Total (¥18,000,000)"
            caption={`${yen(d.lifetimeUsed)} / ${yen(d.lifetimeLimit)}`}
            value={Number(d.lifetimeUsed)}
            max={Number(d.lifetimeLimit)}
            tone="accent"
          />
          <Meter
            label="成長投資枠 sub-cap (¥12,000,000)"
            caption={`${yen(d.growthUsed)} / ${yen(d.growthSubCap)}`}
            value={Number(d.growthUsed)}
            max={Number(d.growthSubCap)}
            tone="profit"
          />
        </div>

        {Number(d.pendingRestoration) > 0 ? (
          <p className={styles.callout}>
            <strong>{yen(d.pendingRestoration)}</strong> of quota returns in{' '}
            <strong>{d.restorationDate}</strong>. Positions sold this year still occupy the lifetime
            pool until then — the annual frames do <em>not</em> come back at all.
          </p>
        ) : null}

        {Number(d.legacyBookValue) > 0 ? (
          <p className={styles.note}>
            旧NISA holdings of {yen(d.legacyBookValue)} are a separate, closed system and are
            excluded from the ¥18M limit.
          </p>
        ) : (
          <p className={styles.note}>
            旧NISA is a separate, closed system and never counts against the ¥18M limit. You
            currently hold nothing in it.
          </p>
        )}
      </Section>

      <Section
        title="Annual frames"
        description="Use it or lose it — an unused annual frame expires on 31 December and never restores, regardless of what you sell."
      >
        <div className={styles.years}>
          {years.map((year) => {
            const frames = d.annual.filter((frame) => frame.year === year)
            return (
              <div key={year} className={styles.yearCard}>
                <h3 className={styles.yearTitle}>{year}</h3>
                {(['NISA_GROWTH', 'NISA_TSUMITATE'] as const).map((frame) => {
                  const a = frames.find((file) => file.frame === frame)
                  const limit = frame === 'NISA_GROWTH' ? 2_400_000 : 1_200_000
                  const used = a ? Number(a.used) : 0
                  return (
                    <Meter
                      key={frame}
                      label={FRAME_LABEL[frame]}
                      caption={
                        a?.isMaxed
                          ? `${yen(used)} — MAXED`
                          : `${yen(used)} / ${yen(limit)} · ${yen(limit - used)} left`
                      }
                      value={used}
                      max={limit}
                      tone={a?.isMaxed ? 'warn' : 'accent'}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="Contributions by year">
        <Table>
          <thead>
            <tr>
              <th scope="col">Year</th>
              <th scope="col" data-numeric>成長投資枠</th>
              <th scope="col" data-numeric>つみたて投資枠</th>
              <th scope="col" data-numeric>Total</th>
              <th scope="col" data-numeric>of ¥3,600,000</th>
            </tr>
          </thead>
          <tbody>
            {d.contributions.map((contribution) => {
              const total = Number(contribution.growth) + Number(contribution.tsumitate)
              return (
                <tr key={contribution.year}>
                  <td>{contribution.year}</td>
                  <td data-numeric>{yen(contribution.growth)}</td>
                  <td data-numeric>{yen(contribution.tsumitate)}</td>
                  <td data-numeric>{yen(total)}</td>
                  <td data-numeric>{pct(total / 3_600_000)}</td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </Section>
    </>
  )
}
