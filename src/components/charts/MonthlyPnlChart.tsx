/**
 * Monthly realized P&L — a diverging bar chart around a zero baseline.
 *
 * Bars grow up from the baseline for a profitable month and down for a losing
 * one, so polarity is carried by *position* first and colour second. That
 * matters: colour alone would be the only signal for a colourblind reader, and
 * the direction is the whole point of the chart.
 *
 * Colours come from `--chart-profit` / `--chart-loss`, which are validated
 * against the card surface (CVD ΔE 9.0 deutan). The lighter text-tone tokens
 * fail the mark lightness band on this surface, so they are deliberately not
 * used here.
 *
 * Each bar is a focusable button carrying its full figures in an `aria-label`.
 * That is what makes the data reachable by keyboard and screen reader without a
 * separate table view.
 */
import { useState } from 'react'
import styles from './MonthlyPnlChart.module.scss'
import { pctSigned, yenCompact, yenSigned } from '~/components/format'
import { cx } from '~/lib/cx'

export interface MonthlyPoint {
  month: string
  realizedJpy: string
  costJpy: string
  returnPct: number | null
  tradeCount: number
}

/** Window controls, when the caller is paging through a longer history. */
export interface WindowNav {
  label: string
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  onLatest: () => void
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The month's name, and its year where a reader needs it: January, and the first column. */
const monthLabel = (month: string, first: boolean) => {
  const [year, monthNumber] = month.split('-')
  const name = MONTHS[Number(monthNumber) - 1] ?? ''
  return { name, year: first || monthNumber === '01' ? (year ?? '') : '' }
}

/**
 * A "nice" axis step — 1, 2, 2.5 or 5 times a power of ten.
 *
 * Dividing the range by a tick count directly gives values like ¥437,291, which
 * are unreadable as axis labels. Snapping to these multiples keeps the gridlines
 * on round numbers a reader can actually anchor to.
 */
function niceStep(range: number, targetTicks: number): number {
  if (range <= 0) return 0
  const raw = range / targetTicks
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / magnitude
  const snapped = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return snapped * magnitude
}

/**
 * Tick values above and below zero, each with its vertical position as a
 * percentage from the top of the plot.
 */
function buildTicks(maxPos: number, maxNeg: number, baselinePct: number) {
  const ticks: { value: number; topPct: number }[] = []

  // 4 divisions above zero: 3 gives a single gridline on a ¥2M month, which is
  // not enough to read a bar height against. Below zero uses fewer, since that
  // region is usually the smaller share of the plot.
  if (maxPos > 0) {
    const step = niceStep(maxPos, 4)
    for (let tick = step; tick <= maxPos * 1.001; tick += step) {
      ticks.push({ value: tick, topPct: baselinePct - (tick / maxPos) * baselinePct })
    }
  }
  if (maxNeg < 0) {
    const span = Math.abs(maxNeg)
    const step = niceStep(span, 2)
    for (let tick = step; tick <= span * 1.001; tick += step) {
      ticks.push({
        value: -tick,
        topPct: baselinePct + (tick / span) * (100 - baselinePct),
      })
    }
  }
  return ticks
}

export function MonthlyPnlChart({ data, nav }: { data: MonthlyPoint[]; nav?: WindowNav }) {
  const [hover, setHover] = useState<number | null>(null)

  if (data.length === 0) {
    return <p className={styles.empty}>No closed trades yet.</p>
  }

  const values = data.map((datum) => Number(datum.realizedJpy))
  const maxPos = Math.max(0, ...values)
  const maxNeg = Math.min(0, ...values)
  const negSpan = Math.abs(maxNeg)

  // Baseline sits proportionally, so the zero line is where the data says: the
  // region above it is maxPos tall and the region below it negSpan tall. That
  // split is what makes a ¥100k gain and a ¥100k loss draw the same length —
  // yen-per-pixel is already equal on both sides of the line.
  const posShare = maxPos / (maxPos + negSpan || 1)
  const baselinePct = maxNeg === 0 ? 100 : maxPos === 0 ? 0 : posShare * 100

  const ticks = buildTicks(maxPos, maxNeg, baselinePct)


  return (
    <div className={styles.card}>
      {nav ? (
        <div className={styles.nav}>
          <span className={styles.navLabel}>{nav.label}</span>
          <div className={styles.navButtons}>
            <button
              type="button"
              className={styles.navButton}
              onClick={nav.onBack}
              disabled={!nav.canGoBack}
              aria-label="Show earlier months"
            >
              ←
            </button>
            <button
              type="button"
              className={styles.navButton}
              onClick={nav.onForward}
              disabled={!nav.canGoForward}
              aria-label="Show later months"
            >
              →
            </button>
            <button
              type="button"
              className={styles.navButton}
              onClick={nav.onLatest}
              disabled={!nav.canGoForward}
            >
              Latest
            </button>
          </div>
        </div>
      ) : null}

      {/* Values sit in their own row above the plot rather than floating beside
          each bar. At this window size one label per column is legible, and a
          shared baseline keeps them from colliding with the marks. */}
      <div className={styles.valueRow} aria-hidden="true">
        <div className={styles.valueSpacer} />
        <div className={styles.valueCells}>
          {data.map((datum) => {
            const realized = Number(datum.realizedJpy)
            return (
              <span
                key={datum.month}
                className={cx(
                  styles.valueCell,
                  datum.tradeCount === 0
                    ? styles.valueMuted
                    : realized >= 0
                      ? styles.profit
                      : styles.loss,
                )}
              >
                <span className={styles.valueAmount}>
                  {datum.tradeCount === 0 ? '·' : yenCompact(realized)}
                </span>
                <span className={styles.valuePct}>
                  {datum.returnPct == null ? '' : pctSigned(datum.returnPct)}
                </span>
              </span>
            )
          })}
        </div>
      </div>

      <div className={styles.wrap}>
        <div className={styles.axis} aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick.value}
              className={styles.axisTick}
              style={{ top: `${String(tick.topPct)}%` }}
            >
              {yenCompact(tick.value, false)}
            </span>
          ))}
          <span className={styles.axisZero} style={{ top: `${String(baselinePct)}%` }}>
            ¥0
          </span>
        </div>

        <div className={styles.plot}>
          {/* Gridlines sit behind the marks and share the axis tick positions,
              so a bar's height can be read off a label rather than guessed. */}
          {ticks.map((tick) => (
            <div
              key={tick.value}
              className={styles.gridline}
              style={{ top: `${String(tick.topPct)}%` }}
              aria-hidden="true"
            />
          ))}
          <div className={styles.baseline} style={{ top: `${String(baselinePct)}%` }} />

          <div className={styles.bars}>
            {data.map((datum, index) => {
              const realized = Number(datum.realizedJpy)
              const positive = realized >= 0
              // Measured against its own side's extent, and as a percentage of the
              // column it lives in — not of the plot. The column is already only
              // baselinePct tall, so folding that share in here would apply it
              // twice and pull every bar back towards zero.
              const heightPct = positive
                ? (realized / (maxPos || 1)) * 100
                : (Math.abs(realized) / (negSpan || 1)) * 100
              const label = monthLabel(datum.month, index === 0)

              return (
                <button
                  type="button"
                  key={datum.month}
                  className={styles.slot}
                  aria-label={
                    datum.tradeCount === 0
                      ? `${datum.month}: no closed trades`
                      : `${datum.month}: ${yenSigned(realized)} realized${datum.returnPct == null ? '' : `, ${pctSigned(datum.returnPct)}`} from ${String(datum.tradeCount)} close${datum.tradeCount === 1 ? '' : 's'}`
                  }
                  onMouseEnter={() => {
                    setHover(index)
                  }}
                  onMouseLeave={() => {
                    setHover(null)
                  }}
                  onFocus={() => {
                    setHover(index)
                  }}
                  onBlur={() => {
                    setHover(null)
                  }}
                >
                  <div className={styles.column} style={{ height: `${String(baselinePct)}%` }}>
                    {positive && realized !== 0 ? (
                      <div
                        className={cx(styles.bar, styles.barUp, hover === index && styles.barHover)}
                        style={{ height: `${String(heightPct)}%` }}
                      />
                    ) : null}
                  </div>

                  <div
                    className={styles.columnDown}
                    style={{ height: `${String(100 - baselinePct)}%` }}
                  >
                    {!positive && realized !== 0 ? (
                      <div
                        className={cx(styles.bar, styles.barDown, hover === index && styles.barHover)}
                        style={{ height: `${String(heightPct)}%` }}
                      />
                    ) : null}
                  </div>

                  {hover === index ? (
                    <div className={styles.tooltip} role="tooltip">
                      <strong>{datum.month}</strong>
                      {datum.tradeCount === 0 ? (
                        <span className={styles.tooltipMeta}>No closes</span>
                      ) : (
                        <>
                          <span className={positive ? styles.profit : styles.loss}>
                            {yenSigned(realized)}
                            {datum.returnPct == null ? '' : `  (${pctSigned(datum.returnPct)})`}
                          </span>
                          <span className={styles.tooltipMeta}>
                            {datum.tradeCount} close{datum.tradeCount === 1 ? '' : 's'} · on{' '}
                            {yenCompact(Number(datum.costJpy), false)} cost
                          </span>
                        </>
                      )}
                    </div>
                  ) : null}

                  <span className={styles.tick} aria-hidden="true">
                    {label.name}
                    {label.year ? <span className={styles.tickYear}>{label.year}</span> : null}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
