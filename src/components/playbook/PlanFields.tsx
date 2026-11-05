/**
 * An exit plan's inputs and its server-computed preview.
 *
 * Shared by the Open Position dialog and Edit plan, so the two cannot come to
 * disagree about what a plan is made of. The preview is the server's: the UI does
 * no financial arithmetic, so stop, R, targets and risk arrive finished.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import styles from './Dialog.module.scss'
import { EXIT_SETTINGS_ANCHOR } from '~/components/exits/settingsAnchor'
import { pct, priceText, ratio } from '~/components/format'
import { FormField } from '~/components/trades/FormField'
import { cx } from '~/lib/cx'
import { TRAILING_METHODS, type TrailingMethod } from '~/lib/exit/types'
import type { ExtraTarget } from '~/lib/playbook/types'
import { previewExitPlan } from '~/server/playbook'

export interface PlanForm {
  supportLevel: string
  stopMultiple: string
  targetMultiple: string
  targetManual: boolean
  target1: string
  extraTargets: ExtraTarget[]
  trailingMethod: TrailingMethod | ''
  note: string
}

export const METHOD_LABEL: Record<TrailingMethod, string> = {
  ATR: 'ATR chandelier',
  SMA10: 'SMA 10',
  SMA20: 'SMA 20',
}

export function PlanInputs({
  form,
  onChange,
  currency,
  defaultMethod,
  live,
}: {
  form: PlanForm
  onChange: (next: PlanForm) => void
  currency: 'JPY' | 'USD'
  defaultMethod: TrailingMethod | null
  /** A static plan has no trail: nothing ever feeds it. */
  live: boolean
}) {
  const unit = currency === 'USD' ? '$' : '¥'
  const set = (patch: Partial<PlanForm>) => {
    onChange({ ...form, ...patch })
  }
  const setTarget = (index: number, patch: Partial<ExtraTarget>) => {
    set({ extraTargets: form.extraTargets.map((target, at) => (at === index ? { ...target, ...patch } : target)) })
  }

  return (
    <>
      <div className={styles.row}>
        <FormField label={`Support level (${unit})`} hint="Must sit below entry">
          <input
            className={styles.input}
            inputMode="decimal"
            value={form.supportLevel}
            onChange={(event) => {
              set({ supportLevel: event.target.value })
            }}
          />
        </FormField>
        <FormField label="Stop ATR ×" hint="Locked into this plan">
          <input
            className={styles.input}
            inputMode="decimal"
            value={form.stopMultiple}
            onChange={(event) => {
              set({ stopMultiple: event.target.value })
            }}
          />
        </FormField>
        <FormField label="Target 1 × R" hint="Locked into this plan">
          <input
            className={styles.input}
            inputMode="decimal"
            value={form.targetMultiple}
            disabled={form.targetManual}
            onChange={(event) => {
              set({ targetMultiple: event.target.value })
            }}
          />
        </FormField>
      </div>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={form.targetManual}
          onChange={(event) => {
            set({ targetManual: event.target.checked })
          }}
        />
        Enter Target 1 by hand
      </label>
      {form.targetManual ? (
        <FormField label={`Target 1 (${unit})`} hint="Must sit above entry">
          <input
            className={styles.input}
            inputMode="decimal"
            value={form.target1}
            onChange={(event) => {
              set({ target1: event.target.value })
            }}
          />
        </FormField>
      ) : null}

      {form.extraTargets.map((target, index) => (
        // The list has no ids and only ever changes by these controls.
        // eslint-disable-next-line react/no-array-index-key
        <div className={styles.targetRow} key={index}>
          <FormField label={`Extra target ${String(index + 1)} (${unit})`}>
            <input
              className={styles.input}
              inputMode="decimal"
              value={target.price}
              onChange={(event) => {
                setTarget(index, { price: event.target.value })
              }}
            />
          </FormField>
          <FormField label="Fraction to sell" hint="0.25 is a quarter">
            <input
              className={styles.input}
              inputMode="decimal"
              value={target.fraction}
              onChange={(event) => {
                setTarget(index, { fraction: event.target.value })
              }}
            />
          </FormField>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              set({ extraTargets: form.extraTargets.filter((_, at) => at !== index) })
            }}
          >
            Remove<span className="visually-hidden"> extra target {index + 1}</span>
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          className={cx(styles.secondary, styles.small)}
          onClick={() => {
            set({ extraTargets: [...form.extraTargets, { price: '', fraction: '' }] })
          }}
        >
          Add a target
        </button>
      </div>

      {live ? (
        <FormField label="Trailing method" hint="Applies only after Target 1">
          <select
            className={styles.input}
            value={form.trailingMethod}
            onChange={(event) => {
              set({ trailingMethod: event.target.value as TrailingMethod | '' })
            }}
          >
            <option value="">Use default{defaultMethod ? ` (${METHOD_LABEL[defaultMethod]})` : ''}</option>
            {TRAILING_METHODS.map((method) => (
              <option key={method} value={method}>
                {METHOD_LABEL[method]}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}
    </>
  )
}

/** The global settings a plan runs under; `exit_rules` has no per-plan columns for them. */
export function FrameworkNote({
  partialExitFraction,
  timeStopDays,
  trailingAtrMultiple,
}: {
  partialExitFraction: string
  timeStopDays: number
  trailingAtrMultiple: string
}) {
  return (
    <p className={styles.note}>
      Partial exit {partialExitFraction} · time stop {timeStopDays} sessions · trail {trailingAtrMultiple} × ATR — global
      settings that apply on the next read. Change them in{' '}
      <Link to="/settings" hash={EXIT_SETTINGS_ANCHOR}>
        Settings
      </Link>
      .
    </p>
  )
}

/** The form's Target 1, as the server takes it. */
export const target1OverrideOf = (form: PlanForm): string | null =>
  form.targetManual && form.target1.trim() !== '' ? form.target1.trim() : null

export function PlanPreview({
  symbol,
  entryDate,
  entryPrice,
  shares,
  form,
  accountEquity,
  currency,
}: {
  symbol: string
  entryDate: string
  entryPrice: string
  shares: string
  form: PlanForm
  accountEquity: string | null
  currency: 'JPY' | 'USD'
}) {
  const input = {
    symbol,
    entryDate,
    entryPrice,
    shares,
    supportLevel: form.supportLevel,
    stopMultiple: form.stopMultiple,
    targetMultiple: form.targetMultiple,
    target1Override: target1OverrideOf(form),
    extraTargets: form.extraTargets,
    accountEquity,
  }
  const key = JSON.stringify(input)
  const [settled, setSettled] = useState(key)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(key)
    }, 300)
    return () => {
      clearTimeout(timer)
    }
  }, [key])

  const preview = useQuery({
    queryKey: ['plan-preview', settled],
    queryFn: () => previewExitPlan({ data: JSON.parse(settled) as typeof input }),
    enabled: form.supportLevel.trim() !== '',
    placeholderData: keepPreviousData,
    gcTime: 0,
  })

  if (form.supportLevel.trim() === '') return <p className={styles.note}>Set a support level to see the stop and risk.</p>
  const answer = preview.data
  if (!answer) return null
  if (!answer.ok) return <p className={styles.note}>{answer.message}</p>
  const { preview: levels } = answer
  return (
    <>
      <div className={styles.preview} aria-live="polite">
        <div className={styles.previewCell}>
          <span>Stop</span>
          <span>{priceText(levels.stop, currency)}</span>
        </div>
        <div className={styles.previewCell}>
          <span>R per share</span>
          <span>{priceText(levels.riskPerShare, currency)}</span>
        </div>
        <div className={styles.previewCell}>
          <span>Target 1</span>
          <span>
            {priceText(levels.target1, currency)} ({levels.plannedR}R)
          </span>
        </div>
        <div className={styles.previewCell}>
          <span>Risked</span>
          <span>
            {priceText(levels.riskAmount, currency)}
            {levels.riskPct === null ? '' : ` · ${pct(levels.riskPct)}`}
          </span>
        </div>
        <div className={styles.previewCell}>
          <span>Size</span>
          <span>{levels.sizePct === null ? '—' : pct(levels.sizePct)}</span>
        </div>
        <div className={styles.previewCell}>
          <span>Risk rating</span>
          <span>{levels.riskRating === null ? '—' : ratio(Number(levels.riskRating), 1)}</span>
        </div>
      </div>
      {levels.fromSupportOnly ? (
        <p className={styles.note}>No bar for the entry date yet, so the stop is the support level alone. A later bar fills in a live plan&apos;s ATR.</p>
      ) : null}
    </>
  )
}
