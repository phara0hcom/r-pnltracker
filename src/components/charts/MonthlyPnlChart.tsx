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

const yen = (v: number) =>
  (v > 0 ? '+' : v < 0 ? '−' : '') +
  '¥' +
  Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })

/** Compact axis labels: ¥1.2M / ¥340k — full precision lives in the tooltip. */
const compact = (v: number) => {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `¥${(v / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `¥${Math.round(v / 1_000).toString()}k`
  return `¥${String(Math.round(v))}`
}

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-')
  return { short: mo ?? '', year: y ?? '' }
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
    for (let v = step; v <= maxPos * 1.001; v += step) {
      ticks.push({ value: v, topPct: baselinePct - (v / maxPos) * baselinePct })
    }
  }
  if (maxNeg < 0) {
    const span = Math.abs(maxNeg)
    const step = niceStep(span, 2)
    for (let v = step; v <= span * 1.001; v += step) {
      ticks.push({ value: -v, topPct: baselinePct + (v / span) * (100 - baselinePct) })
    }
  }
  return ticks
}

export function MonthlyPnlChart({ data, nav }: { data: MonthlyPoint[]; nav?: WindowNav }) {
  const [hover, setHover] = useState<number | null>(null)

  if (data.length === 0) {
    return <p className={styles.empty}>No closed trades yet.</p>
  }

  const values = data.map((d) => Number(d.realizedJpy))
  const maxPos = Math.max(0, ...values)
  const maxNeg = Math.min(0, ...values)
  // Scale both directions off the same magnitude so a ¥100k gain and a ¥100k
  // loss draw the same length — otherwise the chart misrepresents symmetry.
  const scale = Math.max(Math.abs(maxPos), Math.abs(maxNeg)) || 1

  // Baseline sits proportionally, so the zero line is where the data says.
  const posShare = maxPos / (Math.abs(maxPos) + Math.abs(maxNeg) || 1)
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
          {data.map((d) => {
            const v = Number(d.realizedJpy)
            return (
              <span
                key={d.month}
                className={cx(
                  styles.valueCell,
                  d.tradeCount === 0
                    ? styles.valueMuted
                    : v >= 0
                      ? styles.profit
                      : styles.loss,
                )}
              >
                <span className={styles.valueAmount}>
                  {d.tradeCount === 0 ? '·' : compact(v)}
                </span>
                <span className={styles.valuePct}>
                  {d.returnPct == null
                    ? ''
                    : `${d.returnPct >= 0 ? '+' : ''}${(d.returnPct * 100).toFixed(1)}%`}
                </span>
              </span>
            )
          })}
        </div>
      </div>

      <div className={styles.wrap}>
        <div className={styles.axis} aria-hidden="true">
          {ticks.map((t) => (
            <span
              key={t.value}
              className={styles.axisTick}
              style={{ top: `${String(t.topPct)}%` }}
            >
              {compact(t.value)}
            </span>
          ))}
          <span className={styles.axisZero} style={{ top: `${String(baselinePct)}%` }}>
            ¥0
          </span>
        </div>

        <div className={styles.plot}>
          {/* Gridlines sit behind the marks and share the axis tick positions,
              so a bar's height can be read off a label rather than guessed. */}
          {ticks.map((t) => (
            <div
              key={t.value}
              className={styles.gridline}
              style={{ top: `${String(t.topPct)}%` }}
              aria-hidden="true"
            />
          ))}
          <div className={styles.baseline} style={{ top: `${String(baselinePct)}%` }} />

          <div className={styles.bars}>
            {data.map((d, i) => {
              const v = Number(d.realizedJpy)
              const positive = v >= 0
              const heightPct =
                (Math.abs(v) / scale) * (positive ? baselinePct : 100 - baselinePct)
              const label = monthLabel(d.month)

              return (
                <button
                  type="button"
                  key={d.month}
                  className={styles.slot}
                  aria-label={
                    d.tradeCount === 0
                      ? `${d.month}: no closed trades`
                      : `${d.month}: ${yen(v)} realized${d.returnPct == null ? '' : `, ${(d.returnPct * 100).toFixed(1)} percent`} from ${String(d.tradeCount)} close${d.tradeCount === 1 ? '' : 's'}`
                  }
                  onMouseEnter={() => {
                    setHover(i)
                  }}
                  onMouseLeave={() => {
                    setHover(null)
                  }}
                  onFocus={() => {
                    setHover(i)
                  }}
                  onBlur={() => {
                    setHover(null)
                  }}
                >
                  <div className={styles.column} style={{ height: `${String(baselinePct)}%` }}>
                    {positive && v !== 0 ? (
                      <div
                        className={cx(styles.bar, styles.barUp, hover === i && styles.barHover)}
                        style={{ height: `${String(heightPct)}%` }}
                      />
                    ) : null}
                  </div>

                  <div
                    className={styles.columnDown}
                    style={{ height: `${String(100 - baselinePct)}%` }}
                  >
                    {!positive && v !== 0 ? (
                      <div
                        className={cx(styles.bar, styles.barDown, hover === i && styles.barHover)}
                        style={{ height: `${String(heightPct)}%` }}
                      />
                    ) : null}
                  </div>

                  {hover === i ? (
                    <div className={styles.tooltip} role="tooltip">
                      <strong>{d.month}</strong>
                      {d.tradeCount === 0 ? (
                        <span className={styles.tooltipMeta}>No closes</span>
                      ) : (
                        <>
                          <span className={positive ? styles.profit : styles.loss}>
                            {yen(v)}
                            {d.returnPct == null
                              ? ''
                              : `  (${d.returnPct >= 0 ? '+' : ''}${(d.returnPct * 100).toFixed(1)}%)`}
                          </span>
                          <span className={styles.tooltipMeta}>
                            {d.tradeCount} close{d.tradeCount === 1 ? '' : 's'} · on{' '}
                            {compact(Number(d.costJpy))} cost
                          </span>
                        </>
                      )}
                    </div>
                  ) : null}

                  <span className={styles.tick} aria-hidden="true">
                    {label.short}
                    {label.short === '01' ? (
                      <span className={styles.tickYear}>{label.year}</span>
                    ) : null}
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
