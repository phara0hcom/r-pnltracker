/**
 * Trade distribution — one circle per close, on the day it closed.
 *
 * x is calendar time, one column per day. Weekends are kept and shaded rather
 * than dropped: the market is shut then, so a run of empty columns is real
 * information about the gap between two trades, not a hole in the axis.
 *
 * y is return on the cost basis of the units sold; circle *area* is the yen
 * size of the result. Those are different quantities on purpose — a +40%
 * pinhead is a good result on a tiny position, and seeing it beside a +3% coin
 * is the point. Polarity is carried by position first (above or below the zero
 * line) and colour second, so a colourblind reader is never relying on the fill
 * alone.
 *
 * Colours come from `--chart-profit` / `--chart-loss`, matching the monthly
 * chart. Fills are translucent so overlapping circles read as denser rather
 * than hiding each other, with an opaque ring keeping each one's edge legible.
 *
 * Every circle is a focusable button carrying its full figures in an
 * `aria-label`. Between that and the table view beside it, nothing here is
 * reachable only by pointer. The arithmetic lives in
 * `~/lib/charts/tradeScatter`, where it is tested.
 */
import { useState } from 'react'
import styles from './TradeScatter.module.scss'
import { ACCOUNT_LABEL } from '~/components/format'
import {
  type ReturnDomain,
  dayParts,
  percentTicks,
  scatterGeometry,
} from '~/lib/charts/tradeScatter'
import { cx } from '~/lib/cx'

export interface ScatterTrade {
  date: string
  symbol: string
  name: string
  accountType: string
  costJpy: string
  realizedJpy: string
  returnPct: number | null
  holdingDays: number
}

/** Hit-target floor and the largest circle in the dataset, in px. */
const RADIUS = { min: 4, max: 18 }
const COMPACT_RADIUS = { min: 3, max: 13 }

/**
 * Above this many columns the day numbers stop fitting side by side, so only
 * the 1st and every fifth day are labelled — a month, in other words.
 */
const DENSE_COLUMNS = 10

const yen = (amount: number) =>
  '¥' + Math.abs(amount).toLocaleString('en-US', { maximumFractionDigits: 0 })

/** For the result itself, where the sign is the point. Cost basis uses `yen`. */
const yenSigned = (amount: number) =>
  (amount > 0 ? '+' : amount < 0 ? '−' : '') + yen(amount)

const percent = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(1)}%`

export function TradeScatter({
  trades,
  days,
  domain,
  maxMagnitude,
  compact = false,
}: {
  /** The visible window's closes, chronological — DOM order, and so tab order. */
  trades: ScatterTrade[]
  /** The visible window's days, in order. One x coordinate each. */
  days: string[]
  /** Fixed to the whole dataset by the caller, never to this window. */
  domain: ReturnDomain
  /** Largest |realized| across the whole dataset. Sizes every circle. */
  maxMagnitude: number
  compact?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)

  const radius = compact ? COMPACT_RADIUS : RADIUS
  const ticks = percentTicks(domain)

  // A close whose cost basis was zero has no return to plot. It stays in the
  // table and is counted below the chart rather than silently disappearing.
  const plottable = trades.filter(
    (trade): trade is ScatterTrade & { returnPct: number } => trade.returnPct != null,
  )
  const unplottable = trades.length - plottable.length

  // `realizedJpy` is narrowed to a number here and stays one through the marks:
  // it is what sizes the circle, so the geometry needs it as a number anyway.
  const marks = scatterGeometry(
    plottable.map((trade) => ({ ...trade, realizedJpy: Number(trade.realizedJpy) })),
    { days, domain, maxMagnitude, minRadius: radius.min, maxRadius: radius.max },
  )

  const labelEvery = days.length > DENSE_COLUMNS

  return (
    <div className={cx(styles.card, compact && styles.compact)}>
      <div className={styles.wrap}>
        <div className={styles.axis} aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick.value} className={styles.axisTick} style={{ top: `${String(tick.topPct)}%` }}>
              {percent(tick.value)}
            </span>
          ))}
          <span className={styles.axisZero} style={{ top: `${String(domain.zeroPct)}%` }}>
            0%
          </span>
        </div>

        <div className={styles.plot}>
          {/* Weekend shading sits behind everything, one block per column, so
              the eye reads Mon–Fri as the trading run without any extra ink. */}
          <div className={styles.columns} aria-hidden="true">
            {days.map((day) => (
              <div key={day} className={cx(styles.column, dayParts(day).isWeekend && styles.weekend)} />
            ))}
          </div>

          {ticks.map((tick) => (
            <div
              key={tick.value}
              className={styles.gridline}
              style={{ top: `${String(tick.topPct)}%` }}
              aria-hidden="true"
            />
          ))}
          <div className={styles.baseline} style={{ top: `${String(domain.zeroPct)}%` }} />

          {marks.map((mark, index) => {
            const { trade } = mark
            const positive = trade.realizedJpy >= 0
            const size = mark.radius * 2

            return (
              <button
                type="button"
                key={`${trade.date}-${trade.symbol}-${trade.accountType}-${String(index)}`}
                className={cx(styles.mark, positive ? styles.markUp : styles.markDown)}
                style={{
                  left: `${String(mark.xPct)}%`,
                  top: `${String(mark.yPct)}%`,
                  width: `${String(size)}px`,
                  height: `${String(size)}px`,
                }}
                aria-label={`${trade.symbol} on ${trade.date}: ${percent(trade.returnPct)}, ${yenSigned(trade.realizedJpy)} on ${yen(Number(trade.costJpy))} cost, held ${String(trade.holdingDays)} days`}
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
              />
            )
          })}

          {/* Tooltips are rendered after every mark rather than inside one, so
              a small circle's panel is never painted under a larger neighbour. */}
          {marks.map((mark, index) => {
            if (hover !== index) return null
            const { trade } = mark

            return (
              <div
                key={`tip-${String(index)}`}
                role="tooltip"
                className={cx(
                  styles.tooltip,
                  mark.xPct < 22 && styles.tooltipStart,
                  mark.xPct > 78 && styles.tooltipEnd,
                  // Flipped below the mark near the top edge, where a panel
                  // above it would be clipped by the card.
                  mark.yPct < 28 && styles.tooltipBelow,
                )}
                style={{ left: `${String(mark.xPct)}%`, top: `${String(mark.yPct)}%` }}
              >
                <strong>{trade.symbol}</strong>
                {/* Funds carry no ticker, so symbol and name are the same string
                    for them — repeating it would just be a duplicate line. */}
                {trade.name === trade.symbol ? null : (
                  <span className={styles.tooltipMeta}>{trade.name}</span>
                )}
                <span className={trade.realizedJpy >= 0 ? styles.profit : styles.loss}>
                  {percent(trade.returnPct)} · {yenSigned(trade.realizedJpy)}
                </span>
                <span className={styles.tooltipMeta}>
                  {trade.date} · {ACCOUNT_LABEL[trade.accountType] ?? trade.accountType} · held{' '}
                  {trade.holdingDays}d
                </span>
                <span className={styles.tooltipMeta}>on {yen(Number(trade.costJpy))} cost</span>
              </div>
            )
          })}

          {trades.length === 0 ? (
            /* The plot stays drawn behind this: an empty month with its axis and
               its weekends still shows *where* you were not trading, which a
               bare "no data" panel throws away. */
            <p className={styles.empty}>No closes in this period.</p>
          ) : null}
        </div>
      </div>

      <div className={styles.tickRow} aria-hidden="true">
        <div className={styles.tickSpacer} />
        <div className={styles.tickCells}>
          {days.map((day) => {
            const parts = dayParts(day)
            const show = !labelEvery || parts.day === 1 || parts.day % 5 === 0

            return (
              <span key={day} className={cx(styles.tickCell, parts.isWeekend && styles.tickMuted)}>
                {show ? (
                  <>
                    {labelEvery ? null : <span className={styles.tickWeekday}>{parts.weekday}</span>}
                    {parts.day}
                  </>
                ) : null}
              </span>
            )
          })}
        </div>
      </div>

      {unplottable > 0 ? (
        <p className={styles.note}>
          {unplottable} close{unplottable === 1 ? '' : 's'} not shown — no cost basis to measure a
          return against. {unplottable === 1 ? 'It is' : 'They are'} in the table view.
        </p>
      ) : null}
    </div>
  )
}
