/**
 * A captured chart, drawn from its candles: the structure an entry or exit
 * was judged on, with every fill of the review marked on it.
 *
 * Plain SVG rather than a charting library: candles, a few dashed levels and
 * triangles are a few dozen lines, and nothing else in the app draws OHLC.
 * Prices become pixels here and nowhere feeds back — `Number()` is display
 * only, as in `format.ts`.
 */
import { useState } from 'react'
import styles from './CandleChart.module.scss'
import { formatPrice } from './formatPrice'
import type { Currency } from '~/lib/domain/types'
import type { Candle } from '~/lib/playbook/types'
import type { ChartMarker } from '~/server/playbook'

const WIDTH = 720
const PRICE_HEIGHT = 220
const VOLUME_HEIGHT = 40
const GAP = 8
const HEIGHT = PRICE_HEIGHT + GAP + VOLUME_HEIGHT + 18
const AXIS = 64

export interface ChartLevel {
  label: string
  value: string
  kind: 'stop' | 'target' | 'entry'
}

function tickValues(min: number, max: number, count = 4): number[] {
  const step = (max - min) / count
  return Array.from({ length: count + 1 }, (_, i) => min + step * i)
}

export function CandleChart({
  bars,
  markers,
  levels,
  currency,
  interval,
  zone,
  activeLegId,
}: {
  bars: Candle[]
  markers: ChartMarker[]
  levels: ChartLevel[]
  currency: Currency
  interval: string
  /** The exchange's zone — bar times are labelled as that market reads them. */
  zone: string
  /** The leg this chart belongs to; its marker is drawn solid, the others outlined. */
  activeLegId: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (bars.length === 0) return null

  const highs = bars.map((bar) => Number(bar.h))
  const lows = bars.map((bar) => Number(bar.l))
  const levelValues = levels.map((level) => Number(level.value))
  let max = Math.max(...highs, ...levelValues)
  let min = Math.min(...lows, ...levelValues)
  const pad = (max - min) * 0.06 || max * 0.01 || 1
  max += pad
  min -= pad

  const plotWidth = WIDTH - AXIS
  const slot = plotWidth / bars.length
  const body = Math.max(1, slot * 0.66)
  const x = (i: number) => slot * i + slot / 2
  const y = (price: number) => ((max - price) / (max - min)) * PRICE_HEIGHT

  const volumes = bars.map((bar) => (bar.v === null ? 0 : Number(bar.v)))
  const maxVolume = Math.max(...volumes)
  const volumeTop = PRICE_HEIGHT + GAP

  const intraday = !/[DWM]$/.test(interval)
  const label = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    month: 'short',
    day: 'numeric',
    ...(intraday ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : { year: '2-digit' }),
  })

  const shown = hover === null ? bars[bars.length - 1]! : bars[hover]!
  const xLabels = [0, Math.floor(bars.length / 2), bars.length - 1]

  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    setHover(Math.min(bars.length - 1, Math.max(0, Math.floor(ratio * bars.length))))
  }

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.readout}>
        <span>{label.format(new Date(shown.t))}</span>
        <span>O {formatPrice(shown.o, currency)}</span>
        <span>H {formatPrice(shown.h, currency)}</span>
        <span>L {formatPrice(shown.l, currency)}</span>
        <span>C {formatPrice(shown.c, currency)}</span>
      </figcaption>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        role="img"
        aria-label={`${interval} candles, ${String(bars.length)} bars from ${label.format(new Date(bars[0]!.t))} to ${label.format(new Date(bars[bars.length - 1]!.t))}`}
      >
        {tickValues(min + pad, max - pad).map((value) => (
          <g key={value}>
            <line className={styles.grid} x1={0} x2={plotWidth} y1={y(value)} y2={y(value)} />
            <text className={styles.axis} x={plotWidth + 6} y={y(value) + 4}>
              {formatPrice(String(value), currency, true)}
            </text>
          </g>
        ))}

        {markers.flatMap((marker) =>
          marker.placement.kind === 'span'
            ? [
                <rect
                  key={`span-${marker.legId}`}
                  className={marker.kind === 'ENTRY' ? styles.spanEntry : styles.spanExit}
                  x={slot * marker.placement.from}
                  width={slot * (marker.placement.to - marker.placement.from + 1)}
                  y={0}
                  height={PRICE_HEIGHT}
                />,
              ]
            : [],
        )}

        {levels.map((level) => (
          <g key={level.kind}>
            <line
              className={styles[level.kind]}
              x1={0}
              x2={plotWidth}
              y1={y(Number(level.value))}
              y2={y(Number(level.value))}
            />
            <text className={styles.levelLabel} x={4} y={y(Number(level.value)) - 3}>
              {level.label}
            </text>
          </g>
        ))}

        {bars.map((bar, i) => {
          const open = Number(bar.o)
          const close = Number(bar.c)
          const up = close >= open
          const top = y(Math.max(open, close))
          const height = Math.max(1, Math.abs(y(open) - y(close)))
          return (
            <g key={bar.t} className={up ? styles.up : styles.down}>
              <line x1={x(i)} x2={x(i)} y1={y(Number(bar.h))} y2={y(Number(bar.l))} />
              <rect x={x(i) - body / 2} width={body} y={top} height={height} />
              {maxVolume > 0 ? (
                <rect
                  className={styles.volume}
                  x={x(i) - body / 2}
                  width={body}
                  y={volumeTop + VOLUME_HEIGHT * (1 - volumes[i]! / maxVolume)}
                  height={(VOLUME_HEIGHT * volumes[i]!) / maxVolume}
                />
              ) : null}
            </g>
          )
        })}

        {markers.flatMap((marker) => {
          if (marker.placement.kind !== 'bar') return []
          const i = marker.placement.index
          const bar = bars[i]!
          const solid = marker.legId === activeLegId
          const cx = x(i)
          // Entries point up from below the low; exits point down from above the high.
          const path =
            marker.kind === 'ENTRY'
              ? (() => {
                  const tip = y(Number(bar.l)) + 4
                  return `M${String(cx)} ${String(tip)} l6 10 h-12 Z`
                })()
              : (() => {
                  const tip = y(Number(bar.h)) - 4
                  return `M${String(cx)} ${String(tip)} l6 -10 h-12 Z`
                })()
          return [
            <path
              key={`marker-${marker.legId}`}
              d={path}
              className={marker.kind === 'ENTRY' ? styles.markerEntry : styles.markerExit}
              fillOpacity={solid ? 1 : 0.25}
            />,
          ]
        })}

        {hover !== null ? (
          <line
            className={styles.cursor}
            x1={x(hover)}
            x2={x(hover)}
            y1={0}
            y2={volumeTop + VOLUME_HEIGHT}
          />
        ) : null}

        {xLabels.map((i, n) => (
          <text
            key={`x-${String(i)}`}
            className={styles.axis}
            x={x(i)}
            y={HEIGHT - 4}
            textAnchor={n === 0 ? 'start' : n === xLabels.length - 1 ? 'end' : 'middle'}
          >
            {label.format(new Date(bars[i]!.t))}
          </text>
        ))}

        <rect
          className={styles.hit}
          x={0}
          y={0}
          width={plotWidth}
          height={volumeTop + VOLUME_HEIGHT}
          onPointerMove={onMove}
          onPointerLeave={() => {
            setHover(null)
          }}
        />
      </svg>
    </figure>
  )
}
