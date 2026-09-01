import { useId } from 'react'
import styles from './EquitySparkline.module.scss'

/** Cumulative realized P&L as a filled area + line, from first close to latest. */
export function EquitySparkline({
  points,
  tone,
  height = 76,
}: {
  points: { date: string; value: string }[]
  tone: 'profit' | 'loss' | 'flat'
  height?: number
}) {
  const gradientId = useId()

  if (points.length < 2) return null

  const values = points.map((point) => Number(point.value))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min

  // Padded top/bottom so the line never touches the card edge, even at the
  // series' own high/low points.
  const topPad = 2
  const bottomPad = 4
  const plotHeight = 32 - topPad - bottomPad

  const xFor = (index: number) => (index / (points.length - 1)) * 100
  const yFor = (value: number) =>
    topPad + (range > 0 ? (1 - (value - min) / range) * plotHeight : plotHeight / 2)

  const coords = points.map((point, index) => `${String(xFor(index))},${String(yFor(Number(point.value)))}`)
  const areaPoints = `${coords.join(' ')} 100,32 0,32`

  const stroke = tone === 'loss' ? 'var(--color-loss)' : 'var(--color-profit)'
  const first = points[0]
  const last = points.at(-1)

  return (
    <div>
      <svg
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        className={styles.svg}
        style={{ height }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: stroke, stopOpacity: 0.22 }} />
            <stop offset="100%" style={{ stopColor: stroke, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <polygon fill={`url(#${gradientId})`} points={areaPoints} />
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth={1.4}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          points={coords.join(' ')}
        />
      </svg>
      <div className={styles.axis}>
        <span>{first?.date}</span>
        <span>cumulative</span>
        <span>{last?.date}</span>
      </div>
    </div>
  )
}
