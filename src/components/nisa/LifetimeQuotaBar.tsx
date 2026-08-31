import styles from './LifetimeQuotaBar.module.scss'

/**
 * The lifetime ¥18M pool as one segmented bar: 成長投資枠 then つみたて投資枠,
 * a diagonal-hatch overlay on the portion pending restoration, and a tick at
 * the ¥12M 成長 sub-cap.
 *
 * Multiple stacked segments, a hatch overlay and a labelled tick are more than
 * `Meter`'s value/max shape can express, hence a component of its own rather
 * than a `Meter` variant — see the redesign handoff's component-architecture
 * note.
 */
export function LifetimeQuotaBar({
  growthUsed,
  tsumitateUsed,
  pendingRestoration,
  limit,
  subCap,
  height = 22,
}: {
  growthUsed: number
  tsumitateUsed: number
  pendingRestoration: number
  limit: number
  subCap: number
  height?: number
}) {
  const growthPct = limit > 0 ? (growthUsed / limit) * 100 : 0
  const tsumitatePct = limit > 0 ? (tsumitateUsed / limit) * 100 : 0
  const usedPct = growthPct + tsumitatePct
  const pendingPct = limit > 0 ? (pendingRestoration / limit) * 100 : 0
  // The hatch marks the *most recently sold* slice of the used region — the
  // part still occupying the pool only until it restores — so it sits at the
  // trailing edge of what's used, not the leading edge.
  const hatchStart = Math.max(usedPct - pendingPct, 0)
  const subCapPct = limit > 0 ? (subCap / limit) * 100 : 0

  return (
    <div className={styles.bar} style={{ height }}>
      <span className={styles.growth} style={{ width: `${String(growthPct)}%` }} />
      <span
        className={styles.tsumitate}
        style={{ left: `${String(growthPct)}%`, width: `${String(tsumitatePct)}%` }}
      />
      {pendingPct > 0 ? (
        <span className={styles.hatch} style={{ left: `${String(hatchStart)}%`, width: `${String(pendingPct)}%` }} />
      ) : null}
      <span className={styles.tick} style={{ left: `${String(subCapPct)}%` }} />
    </div>
  )
}
