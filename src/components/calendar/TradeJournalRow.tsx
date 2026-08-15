/**
 * One trade inside the calendar day dialog, with its own memo and motivation.
 *
 * Per-trade rather than per-day on purpose: a good day can contain one
 * impulsive trade, and folding that into a single daily score averages away
 * exactly the signal worth keeping.
 *
 * Saving here never touches the trade's figures — it goes through a journal-only
 * server function, so a note can't accidentally mark a row as hand-corrected.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import styles from './TradeJournalRow.module.scss'
import { ACCOUNT_LABEL, qty, tone, yen, yenSigned } from '~/components/format'
import { InstrumentLink } from '~/components/InstrumentLink'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { cx } from '~/lib/cx'
import { saveTradeJournal } from '~/server/notes'
import type { CalendarTrade } from '~/server/screens'

/** Simple pen. `currentColor` so it inherits the button's state colour. */
function PenIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M11.5 1.5a1.414 1.414 0 0 1 2 2L5 12l-3 1 1-3 8.5-8.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Native-currency price. Fund figures already arrive per 10,000 口. */
const price = (v: string, currency: string) =>
  `${currency === 'USD' ? '$' : '¥'}${Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 })}`

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function TradeJournalRow({ trade }: { trade: CalendarTrade }) {
  const queryClient = useQueryClient()

  /** Last persisted values — what Cancel reverts to and what "dirty" compares against. */
  const [savedMemo, setSavedMemo] = useState(trade.memo ?? '')
  const [savedMotivation, setSavedMotivation] = useState<number | null>(trade.motivation)

  const [memo, setMemo] = useState(savedMemo)
  const [motivation, setMotivation] = useState<number | null>(savedMotivation)
  const [open, setOpen] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  const hasJournal = Boolean(savedMemo) || savedMotivation != null
  const dirty = memo.trim() !== savedMemo.trim() || motivation !== savedMotivation

  const save = useMutation({
    mutationFn: (v: { memo: string | null; motivation: number | null }) =>
      saveTradeJournal({ data: { tradeId: trade.id, ...v } }),
    onSuccess: (_r, v) => {
      setSavedMemo(v.memo ?? '')
      setSavedMotivation(v.motivation)
      setJustSaved(true)
      setTimeout(() => {
        setJustSaved(false)
      }, 1600)
      // Local state alone is not enough: the day dialog is re-rendered from the
      // cached calendar query, which has a 5-minute staleTime. Reopening the day
      // would remount this row with the pre-save memo and look like a lost edit.
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
    },
  })

  const commit = () => {
    save.mutate({ memo: memo.trim() || null, motivation })
  }

  /** Discard edits and collapse. Never writes. */
  const cancel = () => {
    setMemo(savedMemo)
    setMotivation(savedMotivation)
    setOpen(false)
  }

  /** Wipe the stored journal for this trade. */
  const clear = () => {
    setMemo('')
    setMotivation(null)
    save.mutate({ memo: null, motivation: null })
  }

  const isClose = trade.side === 'SELL' || trade.side === 'REDEEM'

  return (
    <li className={styles.row}>
      <div className={styles.head}>
        <InstrumentLink
          symbol={trade.symbol}
          name={trade.name}
          assetClass={trade.assetClass}
          size="compact"
        />

        <span className={styles.account}>
          {ACCOUNT_LABEL[trade.accountType] ?? trade.accountType}
        </span>

        <span className={cx(styles.side, isClose ? styles.sideSell : styles.sideBuy)}>
          {trade.side}
        </span>

        <span className={styles.size}>
          <span className={styles.qty}>{qty(trade.quantity)}</span>
          <span className={styles.at}>@ {price(trade.unitPrice, trade.currency)}</span>
          {/* No lot is identified — 移動平均法 pools the units — so this is the
              pool's weighted-average cost at the moment of the sale, which is
              what the realized figure was actually measured against. */}
          {trade.entryPrice != null ? (
            <span
              className={styles.from}
              title={`Closed against a weighted-average cost of ${price(trade.entryPrice, trade.currency)}${
                trade.holdingDays == null
                  ? ''
                  : `, held ${String(trade.holdingDays)} day${trade.holdingDays === 1 ? '' : 's'} on average`
              }. Moving-average cost basis pools units, so no single buy is matched to this sale.`}
            >
              from {price(trade.entryPrice, trade.currency)}
            </span>
          ) : null}
        </span>

        <span className={styles.amount} title={isClose ? 'Proceeds received' : 'Cash paid'}>
          {yen(trade.amountJpy)}
        </span>

        <span className={styles.pnl}>
          {trade.realizedJpy == null ? (
            <span className={styles.muted}>—</span>
          ) : (
            <span className={tone(trade.realizedJpy) === 'profit' ? styles.profit : styles.loss}>
              {yenSigned(trade.realizedJpy)}
            </span>
          )}
        </span>

        <span className={styles.pct}>
          {trade.returnPct == null ? (
            <span className={styles.muted}>—</span>
          ) : (
            <span className={trade.returnPct >= 0 ? styles.profit : styles.loss}>
              {trade.returnPct >= 0 ? '+' : ''}
              {(trade.returnPct * 100).toFixed(1)}%
            </span>
          )}
        </span>

        <button
          type="button"
          className={cx(styles.toggle, hasJournal && styles.toggleActive)}
          aria-expanded={open}
          onClick={() => {
            if (open) cancel()
            else setOpen(true)
          }}
        >
          {open ? <CloseIcon /> : <PenIcon />}
          <span className="visually-hidden">
            {open ? 'Close note for' : hasJournal ? 'Edit note for' : 'Add note for'}{' '}
            {trade.symbol}
          </span>
        </button>
      </div>

      {/* Collapsed summary: a saved note stays readable without reopening the
          editor, which is the whole point of writing it down. */}
      {!open && hasJournal ? (
        <button
          type="button"
          className={styles.saved}
          onClick={() => {
            setOpen(true)
          }}
        >
          {savedMotivation != null ? (
            <span className={styles.savedScore}>
              <span className="visually-hidden">Motivation </span>
              {savedMotivation}
              <span aria-hidden="true">/5</span>
            </span>
          ) : null}
          {savedMemo ? <span className={styles.savedMemo}>{savedMemo}</span> : null}
        </button>
      ) : null}

      {open ? (
        <div className={styles.journal}>
          <fieldset className={styles.fieldset}>
            <legend className={styles.label}>Motivation</legend>
            <div className={styles.scores}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className={cx(styles.score, motivation === n && styles.scoreActive)}>
                  <input
                    type="radio"
                    name={`motivation-${trade.id}`}
                    className="visually-hidden"
                    checked={motivation === n}
                    onChange={() => {
                      setMotivation(n)
                    }}
                    onClick={() => {
                      // Clicking the active value clears it, so "not recorded"
                      // stays reachable after a mis-click.
                      if (motivation === n) setMotivation(null)
                    }}
                  />
                  <span aria-hidden="true">{n}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className={styles.memoField}>
            <span className={styles.label}>Note</span>
            <textarea
              className={styles.memoInput}
              rows={2}
              value={memo}
              placeholder="Why this trade? What would you repeat or avoid?"
              onChange={(e) => {
                setMemo(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  // The day dialog binds the same chord on its content element.
                  // Without this the event bubbles on, saving a blank day-level
                  // note and closing the dialog out from under this trade.
                  e.stopPropagation()
                  commit()
                }
              }}
            />
          </label>

          <div className={styles.actions}>
            <button
              type="button"
              className={cx(styles.actionButton, styles.primary)}
              disabled={!dirty || save.isPending}
              onClick={commit}
            >
              {save.isPending ? 'Saving…' : justSaved ? 'Saved' : 'Save'}
            </button>

            {/* Cancel while nothing is stored; once a journal exists the same
                slot deletes it, so the destructive action only appears when
                there is actually something to destroy. */}
            {hasJournal ? (
              <ConfirmButton onConfirm={clear} confirmLabel="Delete?" disabled={save.isPending}>
                Delete
              </ConfirmButton>
            ) : (
              <button type="button" className={styles.actionButton} onClick={cancel}>
                Cancel
              </button>
            )}

            <span className={styles.status} aria-live="polite">
              {dirty && !save.isPending ? 'Unsaved' : ''}
            </span>
          </div>
        </div>
      ) : null}
    </li>
  )
}
