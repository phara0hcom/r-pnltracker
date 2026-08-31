import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import styles from './nisa.module.scss'
import { pct, yen } from '~/components/format'
import { LifetimeQuotaBar } from '~/components/nisa/LifetimeQuotaBar'
import { HeroStat, PageHeader, SegmentedTabs, StatStrip, StripCell, Table } from '~/components/screen'
import { useIsMobile } from '~/components/ui/useIsMobile'
import { cx } from '~/lib/cx'
import { getNisa, NISA_ANNUAL_LIMITS } from '~/server/screens'

export const Route = createFileRoute('/_authed/nisa')({
  loader: () => getNisa(),
  component: Nisa,
})

const FRAME_LABEL = {
  NISA_GROWTH: '成長投資枠',
  NISA_TSUMITATE: 'つみたて投資枠',
} as const

const FRAME_COLOR = {
  NISA_GROWTH: 'var(--color-nisa-growth)',
  NISA_TSUMITATE: 'var(--color-nisa-tsumitate)',
} as const

const TABS = [
  { id: 'quota' as const, label: 'Quota' },
  { id: 'byYear' as const, label: 'By year' },
]

/** One annual frame's bar row — label, the *remaining* figure (what expires), then the bar. */
function AnnualFrameRow({
  frame,
  used,
  limit,
  isMaxed,
  large,
}: {
  frame: 'NISA_GROWTH' | 'NISA_TSUMITATE'
  used: number
  limit: number
  isMaxed: boolean
  large?: boolean
}) {
  const remaining = Math.max(limit - used, 0)
  const fillPct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0

  return (
    <div>
      <div className={styles.frameHead}>
        <span className={styles.frameLabel}>{FRAME_LABEL[frame]}</span>
        <span>
          <strong className={cx(styles.frameLeft, large && styles.frameLeftLarge)}>{yen(remaining)}</strong>
          <span className={styles.frameLeftSuffix}> left</span>
        </span>
      </div>
      <div className={styles.frameTrack}>
        <div className={styles.frameFill} style={{ width: `${String(fillPct)}%`, backgroundColor: FRAME_COLOR[frame] }} />
      </div>
      <p className={styles.frameCaption}>{isMaxed ? `${yen(used)} — MAXED` : `${yen(used)} of ${yen(limit)} used`}</p>
    </div>
  )
}

function Nisa() {
  const d = Route.useLoaderData()
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('quota')
  const currentYearFrames = d.annual.filter((frame) => frame.year === d.year)
  const growthLimit = Number(NISA_ANNUAL_LIMITS.growth)
  const tsumitateLimit = Number(NISA_ANNUAL_LIMITS.tsumitate)
  const currentYearLeft = currentYearFrames.reduce(
    (running, frame) => running + Math.max(Number(frame.remaining), 0),
    0,
  )

  const lifetimeBar = (
    <LifetimeQuotaBar
      growthUsed={Number(d.growthUsed)}
      tsumitateUsed={Number(d.tsumitateUsed)}
      pendingRestoration={Number(d.pendingRestoration)}
      limit={Number(d.lifetimeLimit)}
      subCap={Number(d.growthSubCap)}
      height={isMobile ? 14 : 22}
    />
  )

  const annualFrames = (
    <>
      <div className={styles.framesHead}>
        <h2 className={isMobile ? styles.spSectionTitle : undefined}>{d.year} annual frames</h2>
        <span className={styles.daysLeftPill}>{d.daysLeftInYear} days left</span>
      </div>
      <p className={isMobile ? styles.spSectionDesc : styles.framesDesc}>
        Use it or lose it. An unused frame expires on 31 December and never restores, whatever you
        sell.
      </p>
      {isMobile ? (
        <div className={styles.spFrames}>
          {(['NISA_GROWTH', 'NISA_TSUMITATE'] as const).map((frame) => {
            const a = currentYearFrames.find((file) => file.frame === frame)
            const limit = frame === 'NISA_GROWTH' ? growthLimit : tsumitateLimit
            return (
              <AnnualFrameRow
                key={frame}
                frame={frame}
                used={a ? Number(a.used) : 0}
                limit={limit}
                isMaxed={a?.isMaxed ?? false}
              />
            )
          })}
        </div>
      ) : (
        <div className={styles.framesCard}>
          {(['NISA_GROWTH', 'NISA_TSUMITATE'] as const).map((frame) => {
            const a = currentYearFrames.find((file) => file.frame === frame)
            const limit = frame === 'NISA_GROWTH' ? growthLimit : tsumitateLimit
            return (
              <AnnualFrameRow
                key={frame}
                frame={frame}
                used={a ? Number(a.used) : 0}
                limit={limit}
                isMaxed={a?.isMaxed ?? false}
                large
              />
            )
          })}
          <p className={styles.framesNote}>
            Selling returns the acquisition cost to the lifetime pool, but only from January of the
            following year — the annual frames do not come back at all.
          </p>
        </div>
      )}
    </>
  )

  const contributionsTable = (
    <Table>
      <thead>
        <tr>
          <th scope="col">Year</th>
          <th scope="col" data-numeric>成長投資枠</th>
          <th scope="col" data-numeric>つみたて投資枠</th>
          <th scope="col" data-numeric>Total</th>
          <th scope="col" className={styles.ofColumn}>of ¥3,600,000</th>
        </tr>
      </thead>
      <tbody>
        {d.contributions.map((contribution) => {
          const growth = Number(contribution.growth)
          const tsumitate = Number(contribution.tsumitate)
          const total = growth + tsumitate
          const ceiling = 3_600_000
          const maxed = total >= ceiling
          return (
            <tr key={contribution.year}>
              <td className={styles.yearCell}>{contribution.year}</td>
              <td data-numeric>{yen(contribution.growth)}</td>
              <td data-numeric>{yen(contribution.tsumitate)}</td>
              <td data-numeric className={styles.yearCell}>{yen(total)}</td>
              <td>
                <div className={styles.contribCell}>
                  <div className={styles.contribTrack}>
                    <span
                      className={styles.contribGrowth}
                      style={{ width: `${String((growth / ceiling) * 100)}%` }}
                    />
                    <span
                      className={styles.contribTsumitate}
                      style={{ left: `${String((growth / ceiling) * 100)}%`, width: `${String((tsumitate / ceiling) * 100)}%` }}
                    />
                  </div>
                  <span className={cx(styles.contribPct, maxed && styles.profit)}>
                    {maxed ? 'MAXED' : pct(total / ceiling)}
                  </span>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )

  return (
    <>
      <PageHeader
        title="NISA"
        meta={`非課税保有限度額 · ${pct(d.lifetimeUtilization)} of ¥18,000,000 used${isMobile ? '' : ', at acquisition cost'}`}
      />

      <div className={styles.heroRow}>
        <HeroStat
          label="Headroom"
          value={yen(d.lifetimeRemaining)}
          tone="profit"
          context={`of ¥18,000,000${Number(d.pendingRestoration) > 0 ? ` · ${yen(d.pendingRestoration)} more returns in ${d.restorationDate}` : ''}`}
        >
          {isMobile ? (
            <>
              <div className={styles.spLifetimeBar}>{lifetimeBar}</div>
              <p className={styles.spSubCapCaption}>
                Line marks the 成長投資枠 {yen(d.growthSubCap)} sub-cap
              </p>
            </>
          ) : null}
        </HeroStat>
        <StatStrip>
          <StripCell label="Lifetime used" value={yen(d.lifetimeUsed)} hint="at acquisition cost" />
          <StripCell label="成長投資枠 held" value={yen(d.growthUsed)} hint={`of ${yen(d.growthSubCap)} sub-cap`} />
          <StripCell label="つみたて投資枠 held" value={yen(d.tsumitateUsed)} hint="no sub-cap" />
          <StripCell label={`${String(d.year)} frames left`} value={yen(currentYearLeft)} tone="loss" hint="expires 31 Dec" />
          <StripCell label={`Restoring ${d.restorationDate}`} value={yen(d.pendingRestoration)} hint="from this year's sales" />
          <StripCell label="旧NISA" value={yen(d.legacyBookValue)} hint="outside the ¥18M pool" />
        </StatStrip>
      </div>

      {isMobile ? (
        <SegmentedTabs tabs={TABS} active={tab} onChange={setTab} label="Section" />
      ) : (
        <section className={styles.lifetimeCard}>
          <div className={styles.lifetimeHead}>
            <h2 className={styles.lifetimeTitle}>Lifetime limit</h2>
            <p className={styles.lifetimeDesc}>Measured at book value, so gains never consume quota.</p>
          </div>
          {lifetimeBar}
          <div className={styles.subCapWrap}>
            <span
              className={styles.subCapCaption}
              style={{ left: `${String((Number(d.growthSubCap) / Number(d.lifetimeLimit)) * 100)}%` }}
            >
              成長投資枠 sub-cap {yen(d.growthSubCap)}
            </span>
          </div>
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: 'var(--color-nisa-growth)' }} />
              <span className={styles.legendLabel}>成長投資枠</span>
              <strong className={styles.legendValue}>{yen(d.growthUsed)}</strong>
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: 'var(--color-nisa-tsumitate)' }} />
              <span className={styles.legendLabel}>つみたて投資枠</span>
              <strong className={styles.legendValue}>{yen(d.tsumitateUsed)}</strong>
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: 'var(--color-border-strong)' }} />
              <span className={styles.legendLabel}>Restoring {d.restorationDate}</span>
              <strong className={styles.legendValue}>{yen(d.pendingRestoration)}</strong>
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: 'var(--color-surface-raised)' }} />
              <span className={styles.legendLabel}>Headroom</span>
              <strong className={styles.legendValue}>{yen(d.lifetimeRemaining)}</strong>
            </span>
          </div>
        </section>
      )}

      {isMobile ? (
        <>
          {tab === 'quota' ? annualFrames : null}
          {tab === 'byYear' ? (
            <>
              {contributionsTable}
              <p className={styles.note}>
                旧NISA holdings of {yen(d.legacyBookValue)} are a separate, closed system, excluded
                from the ¥18M limit.
              </p>
            </>
          ) : null}
        </>
      ) : (
        <div className={styles.twoCol}>
          <section>{annualFrames}</section>
          <section>
            <h2 className={styles.colTitle}>Contributions by year</h2>
            <p className={styles.colDesc}>Each year against its ¥3,600,000 combined ceiling.</p>
            {contributionsTable}
            <p className={styles.note}>
              旧NISA holdings of {yen(d.legacyBookValue)} are a separate, closed system, excluded
              from the ¥18M limit.
            </p>
          </section>
        </div>
      )}
    </>
  )
}
