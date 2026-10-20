/**
 * One entry or exit of a review: the fill, its rating and explanation, and
 * the charts it was judged on.
 *
 * A linked leg's date, price and size belong to its trade and are shown, not
 * edited; correcting them is a trade edit, made on Trades. Its time *is*
 * editable, because no export carries one and an intraday chart needs it to
 * mark the bar rather than the day.
 */
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { CandleChart, type ChartLevel } from './CandleChart'
import { formatPrice } from './formatPrice'
import styles from './LegCard.module.scss'
import { RatingInput } from './RatingInput'
import { money, qty } from '~/components/format'
import { FormField } from '~/components/trades/FormField'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { cx } from '~/lib/cx'
import type { Currency } from '~/lib/domain/types'
import { reportError } from '~/lib/observability/report'
import { CHART_INTERVALS, type CandleSource, type LegKind } from '~/lib/playbook/types'
import { captureChartFn, deleteChartFn, type ChartView } from '~/server/playbook'

export interface LegForm {
  /** The saved id, or a temporary key for a leg added since the last save. */
  key: string
  id?: string
  kind: LegKind
  tradeId: string | null
  tradeMissing: boolean
  date: string
  time: string
  price: string
  quantity: string
  fee: string
  rating: number | null
  explanation: string
}

const SOURCE_LABEL: Record<CandleSource, string> = {
  TRADINGVIEW: 'TradingView alert',
  YAHOO: 'Yahoo',
}

function ChartCapture({
  legId,
  existing,
  tvIntervals,
  onCaptured,
}: {
  legId: string
  existing: string[]
  tvIntervals: string[]
  onCaptured: () => void
}) {
  const [timeframe, setTimeframe] = useState<string>('1D')
  // TradingView when the alert has sent this timeframe — it is what was on screen.
  const [source, setSource] = useState<CandleSource | null>(null)
  const chosenSource: CandleSource =
    source ?? (tvIntervals.includes(timeframe) ? 'TRADINGVIEW' : 'YAHOO')
  const [error, setError] = useState<string | null>(null)

  const capture = useMutation({
    mutationFn: () =>
      captureChartFn({ data: { legId, interval: timeframe, source: chosenSource } }),
    onSuccess: (result) => {
      if (result.ok) {
        setError(null)
        onCaptured()
      } else {
        setError(result.error)
      }
    },
    onError: (failure: unknown) => {
      reportError(failure, { mutation: 'captureChart' })
      setError(failure instanceof Error ? failure.message : 'Could not capture the chart')
    },
  })

  return (
    <div className={styles.capture}>
      <select
        className={styles.input}
        aria-label="Timeframe"
        value={timeframe}
        onChange={(event) => {
          setTimeframe(event.target.value)
        }}
      >
        {CHART_INTERVALS.map((option) => (
          <option key={option} value={option}>
            {option}
            {existing.includes(option) ? ' (recapture)' : ''}
          </option>
        ))}
      </select>
      <select
        className={styles.input}
        aria-label="Source"
        value={chosenSource}
        onChange={(event) => {
          setSource(event.target.value as CandleSource)
        }}
      >
        {(['TRADINGVIEW', 'YAHOO'] as const).map((option) => (
          <option key={option} value={option}>
            {SOURCE_LABEL[option]}
            {option === 'TRADINGVIEW' && !tvIntervals.includes(timeframe) ? ' — no bars yet' : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={styles.secondary}
        disabled={capture.isPending}
        onClick={() => {
          capture.mutate()
        }}
      >
        {capture.isPending ? 'Capturing…' : 'Capture chart'}
      </button>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function LegCard({
  leg,
  onChange,
  onRemove,
  currency,
  charts,
  levels,
  zone,
  tvIntervals,
  onChartsChanged,
}: {
  leg: LegForm
  onChange: (leg: LegForm) => void
  onRemove: () => void
  currency: Currency
  charts: ChartView[]
  levels: ChartLevel[]
  zone: string
  tvIntervals: string[]
  onChartsChanged: () => void
}) {
  const linked = leg.tradeId !== null
  const noun = leg.kind === 'ENTRY' ? 'entry' : 'exit'

  const removeChart = useMutation({
    mutationFn: (id: string) => deleteChartFn({ data: { id } }),
    onSuccess: onChartsChanged,
  })

  return (
    <article className={cx(styles.card, leg.kind === 'ENTRY' ? styles.entry : styles.exit)}>
      <header className={styles.head}>
        <span className={styles.kind}>{leg.kind === 'ENTRY' ? 'Entry' : 'Exit'}</span>
        {linked ? (
          <span className={styles.fill}>
            {leg.date} · {qty(leg.quantity)} @ {formatPrice(leg.price, currency)}
            {Number(leg.fee) > 0 ? ` · fees ${money(leg.fee, currency)}` : ''}
          </span>
        ) : null}
        {leg.tradeMissing ? (
          <span className={styles.warn}>Trade deleted — showing the copy kept here</span>
        ) : null}
        <ConfirmButton onConfirm={onRemove} size="small" variant="text" confirmLabel="Remove?">
          Remove
        </ConfirmButton>
      </header>

      <div className={styles.fields}>
        {linked ? null : (
          <>
            <FormField label="Date">
              <input
                className={styles.input}
                type="date"
                value={leg.date}
                onChange={(event) => {
                  onChange({ ...leg, date: event.target.value })
                }}
                required
              />
            </FormField>
            <FormField label={`Price (${currency === 'JPY' ? '¥' : '$'})`}>
              <input
                className={styles.input}
                inputMode="decimal"
                value={leg.price}
                onChange={(event) => {
                  onChange({ ...leg, price: event.target.value })
                }}
                required
              />
            </FormField>
            <FormField label="Quantity">
              <input
                className={styles.input}
                inputMode="decimal"
                value={leg.quantity}
                onChange={(event) => {
                  onChange({ ...leg, quantity: event.target.value })
                }}
                required
              />
            </FormField>
            <FormField label="Fees">
              <input
                className={styles.input}
                inputMode="decimal"
                value={leg.fee}
                onChange={(event) => {
                  onChange({ ...leg, fee: event.target.value })
                }}
              />
            </FormField>
          </>
        )}
        <FormField label="Time" hint="Exchange time — marks the bar on intraday charts">
          <input
            className={styles.input}
            type="time"
            value={leg.time}
            onChange={(event) => {
              onChange({ ...leg, time: event.target.value })
            }}
          />
        </FormField>
      </div>

      <div className={styles.rating}>
        <span className={styles.label}>Setup quality of this {noun}</span>
        <RatingInput
          label={`Rating for this ${noun}`}
          value={leg.rating}
          onChange={(rating) => {
            onChange({ ...leg, rating })
          }}
        />
      </div>

      <FormField label={`Why this ${noun}`}>
        <textarea
          className={cx(styles.input, styles.textarea)}
          value={leg.explanation}
          onChange={(event) => {
            onChange({ ...leg, explanation: event.target.value })
          }}
          placeholder={
            leg.kind === 'ENTRY'
              ? 'What the chart showed, what triggered it, where the stop went and why'
              : 'Why here — target, stop, trail, or a reason outside the plan'
          }
        />
      </FormField>

      <div className={styles.charts}>
        {charts.map((chart) => (
          <div key={chart.id} className={styles.chart}>
            <div className={styles.chartHead}>
              <span className={styles.interval}>{chart.interval}</span>
              <span className={styles.meta}>
                {SOURCE_LABEL[chart.source]} · captured {chart.capturedAt.slice(0, 10)}
              </span>
              <ConfirmButton
                onConfirm={() => {
                  removeChart.mutate(chart.id)
                }}
                size="small"
                variant="text"
                confirmLabel="Remove?"
              >
                Remove chart
              </ConfirmButton>
            </div>
            <CandleChart
              bars={chart.bars}
              markers={chart.markers}
              levels={levels}
              currency={currency}
              interval={chart.interval}
              zone={zone}
              activeLegId={leg.id ?? ''}
            />
          </div>
        ))}

        {leg.id ? (
          <ChartCapture
            legId={leg.id}
            existing={charts.map((chart) => chart.interval)}
            tvIntervals={tvIntervals}
            onCaptured={onChartsChanged}
          />
        ) : (
          <p className={styles.meta}>Save the review to capture charts for this {noun}.</p>
        )}
      </div>
    </article>
  )
}
