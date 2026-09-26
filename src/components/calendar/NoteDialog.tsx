/**
 * Journal editor for one day.
 *
 * Built on Radix Dialog, which supplies focus trapping, Escape-to-close, and
 * `aria-modal` — the parts of a modal that are easy to get subtly wrong by hand.
 * Mood and motivation are 1–5 radio groups rather than sliders: five discrete
 * values are faster to hit and are announced properly by screen readers.
 *
 * Saving closes the dialog immediately and the day square updates from the
 * optimistic cache write, so there is no pending state to show here — the round
 * trip stores text the user has already read back on the calendar.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import styles from './NoteDialog.module.scss'
import { ScoreGroup } from './ScoreGroup'
import { TradeJournalRow } from './TradeJournalRow'
import { MarketInline } from '~/components/pnl/MarketSplit'
import { DayOrderList, type DayOrderItem } from '~/components/trades/DayOrderList'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { cx } from '~/lib/cx'
import type { CalendarDay } from '~/server/screens'
import { reorderDay } from '~/server/trades'

export interface NotePayload {
  date: string
  title?: string
  body?: string
  mood?: number | null
  motivation?: number | null
  tags?: string[]
}

/** A calendar trade as the reorder list shows it. Fund prices are per 10,000 口. */
const orderItem = (trade: CalendarDay['trades'][number]): DayOrderItem => ({
  id: trade.id,
  symbol: trade.symbol,
  accountType: trade.accountType,
  side: trade.side,
  quantity: trade.quantity,
  price: `${trade.currency === 'USD' ? '$' : '¥'}${Number(trade.unitPrice).toLocaleString('en-US', {
    maximumFractionDigits: 4,
  })}`,
})

const MOOD_LABELS = ['', 'Awful', 'Poor', 'Neutral', 'Good', 'Great']
const MOTIVATION_LABELS = ['', 'Drained', 'Low', 'Steady', 'Driven', 'Sharp']

export function NoteDialog({
  day,
  onClose,
  onSave,
  onDelete,
}: {
  day: CalendarDay
  onClose: () => void
  onSave: (note: NotePayload) => void
  onDelete: (date: string) => void
}) {
  const [title, setTitle] = useState(day.note?.title ?? '')
  const [body, setBody] = useState(day.note?.body ?? '')
  const [mood, setMood] = useState<number | null>(day.note?.mood ?? null)
  const [motivation, setMotivation] = useState<number | null>(day.note?.motivation ?? null)
  const [tagText, setTagText] = useState((day.note?.tags ?? []).join(', '))

  /** The order being edited, or null when the list is showing normally. */
  const [ordering, setOrdering] = useState<DayOrderItem[] | null>(null)
  const [orderError, setOrderError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const saveOrder = useMutation({
    mutationFn: (ids: string[]) => reorderDay({ data: { date: day.date, ids } }),
    onSuccess: (result) => {
      if (!result.ok) {
        setOrderError(result.message)
        return
      }
      setOrdering(null)
      setOrderError(null)
      // Every realized figure after this day can move, not just this dialog's.
      void queryClient.invalidateQueries()
    },
  })

  const submit = () => {
    onSave({
      date: day.date,
      title: title.trim() || undefined,
      body: body.trim() || undefined,
      mood,
      motivation,
      tags: tagText
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    })
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.content}
          onKeyDown={(event) => {
            // Cmd/Ctrl+Enter saves — Enter alone must stay usable in the textarea.
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
          }}
        >
          <div className={styles.head}>
            <div>
              <Dialog.Title className={styles.title}>{day.date}</Dialog.Title>
              <Dialog.Description className={styles.subtitle}>
                {day.tradeCount > 0
                  ? `${String(day.tradeCount)} trade${day.tradeCount === 1 ? '' : 's'}`
                  : 'No trades'}
                {day.markets ? (
                  <>
                    {' · realized '}
                    <MarketInline split={day.markets} />
                  </>
                ) : null}
              </Dialog.Description>
            </div>
            <Dialog.Close className={styles.close} aria-label="Close">
              ×
            </Dialog.Close>
          </div>

          <div className={styles.body}>
            {day.trades.length > 0 ? (
              <section className={styles.tradesSection}>
                <div className={styles.tradesHead}>
                  <h3 className={styles.sectionTitle}>
                    Trades ({day.trades.length})
                  </h3>
                  <span className={styles.tradesHint}>
                    {ordering
                      ? 'First trade of the day at the top'
                      : day.ordered
                        ? 'In the order you set'
                        : 'Grouped by instrument — Rakuten exports carry no execution time'}
                  </span>
                  {ordering || day.trades.length < 2 ? null : (
                    <button
                      type="button"
                      className={styles.orderButton}
                      onClick={() => {
                        setOrdering(day.trades.map(orderItem))
                      }}
                    >
                      Set order
                    </button>
                  )}
                </div>
                {ordering ? (
                  <>
                    <DayOrderList
                      items={ordering}
                      onChange={setOrdering}
                      label={`Order of trades on ${day.date}`}
                    />
                    <div className={styles.orderActions}>
                      <button
                        type="button"
                        className={cx(styles.button, styles.primary)}
                        disabled={saveOrder.isPending}
                        onClick={() => {
                          saveOrder.mutate(ordering.map((item) => item.id))
                        }}
                      >
                        {saveOrder.isPending ? 'Saving…' : 'Save order'}
                      </button>
                      <button
                        type="button"
                        className={styles.button}
                        onClick={() => {
                          setOrdering(null)
                          setOrderError(null)
                        }}
                      >
                        Cancel
                      </button>
                      <span className={styles.orderError} role="status">
                        {orderError ?? (saveOrder.isError ? 'Could not save the order.' : '')}
                      </span>
                    </div>
                  </>
                ) : (
                  <ul className={styles.tradeList}>
                    {day.trades.map((trade) => (
                      <TradeJournalRow key={trade.id} trade={trade} />
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            <h3 className={styles.sectionTitle}>How the day felt</h3>

            <ScoreGroup
              legend="Mood"
              labels={MOOD_LABELS}
              value={mood}
              onChange={setMood}
              name="mood"
            />
            <ScoreGroup
              legend="Motivation"
              labels={MOTIVATION_LABELS}
              value={motivation}
              onChange={setMotivation}
              name="motivation"
            />

            <label className={styles.field}>
              <span className={styles.label}>Title</span>
              <input
                type="text"
                className={styles.input}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                }}
                placeholder="One line on the day"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Notes</span>
              <textarea
                className={styles.textarea}
                rows={6}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value)
                }}
                placeholder="What did you do, and why? What would you repeat or avoid?"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Tags</span>
              <input
                type="text"
                className={styles.input}
                value={tagText}
                onChange={(event) => {
                  setTagText(event.target.value)
                }}
                placeholder="revenge-trade, plan-followed, news-driven"
              />
              <span className={styles.hint}>Comma separated</span>
            </label>
          </div>

          <div className={styles.footer}>
            <span className={styles.hint}>⌘/Ctrl + Enter to save</span>
            <div className={styles.footerActions}>
              {day.note ? (
                <ConfirmButton
                  confirmLabel="Delete entry?"
                  onConfirm={() => {
                    onDelete(day.date)
                  }}
                >
                  Delete
                </ConfirmButton>
              ) : null}
              <Dialog.Close className={styles.button}>Cancel</Dialog.Close>
              <button
                type="button"
                className={cx(styles.button, styles.primary)}
                onClick={submit}
              >
                Save entry
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
