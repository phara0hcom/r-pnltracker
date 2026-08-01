/**
 * Journal editor for one day.
 *
 * Built on Radix Dialog, which supplies focus trapping, Escape-to-close, and
 * `aria-modal` — the parts of a modal that are easy to get subtly wrong by hand.
 * Mood and motivation are 1–5 radio groups rather than sliders: five discrete
 * values are faster to hit and are announced properly by screen readers.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import styles from './NoteDialog.module.scss'
import { TradeJournalRow } from './TradeJournalRow'
import { tone, yenSigned } from '~/components/format'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { cx } from '~/lib/cx'
import type { CalendarDay } from '~/server/screens'

export interface NotePayload {
  date: string
  title?: string
  body?: string
  mood?: number | null
  motivation?: number | null
  tags?: string[]
}

const MOOD_LABELS = ['', 'Awful', 'Poor', 'Neutral', 'Good', 'Great']
const MOTIVATION_LABELS = ['', 'Drained', 'Low', 'Steady', 'Driven', 'Sharp']

export function NoteDialog({
  day,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  day: CalendarDay
  saving: boolean
  onClose: () => void
  onSave: (note: NotePayload) => void
  onDelete: (date: string) => void
}) {
  const [title, setTitle] = useState(day.note?.title ?? '')
  const [body, setBody] = useState(day.note?.body ?? '')
  const [mood, setMood] = useState<number | null>(day.note?.mood ?? null)
  const [motivation, setMotivation] = useState<number | null>(day.note?.motivation ?? null)
  const [tagText, setTagText] = useState((day.note?.tags ?? []).join(', '))

  const pnl = day.realizedJpy == null ? null : Number(day.realizedJpy)

  const submit = () => {
    onSave({
      date: day.date,
      title: title.trim() || undefined,
      body: body.trim() || undefined,
      mood,
      motivation,
      tags: tagText
        .split(',')
        .map((t) => t.trim())
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
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter saves — Enter alone must stay usable in the textarea.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
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
                {pnl != null ? (
                  <>
                    {' · '}
                    <span
                      className={
                        tone(pnl) === 'profit'
                          ? styles.profit
                          : tone(pnl) === 'loss'
                            ? styles.loss
                            : undefined
                      }
                    >
                      {yenSigned(pnl)} realized
                    </span>
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
                    Grouped by instrument — Rakuten exports carry no execution time
                  </span>
                </div>
                <ul className={styles.tradeList}>
                  {day.trades.map((t) => (
                    <TradeJournalRow key={t.id} trade={t} />
                  ))}
                </ul>
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
                onChange={(e) => {
                  setTitle(e.target.value)
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
                onChange={(e) => {
                  setBody(e.target.value)
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
                onChange={(e) => {
                  setTagText(e.target.value)
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
                  disabled={saving}
                >
                  Delete
                </ConfirmButton>
              ) : null}
              <Dialog.Close className={styles.button}>Cancel</Dialog.Close>
              <button
                type="button"
                className={cx(styles.button, styles.primary)}
                onClick={submit}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save entry'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * 1–5 selector as a radio group.
 *
 * Clicking the selected value clears it, so "not recorded" stays reachable —
 * otherwise a mis-click could never be undone.
 */
function ScoreGroup({
  legend,
  labels,
  value,
  onChange,
  name,
}: {
  legend: string
  labels: string[]
  value: number | null
  onChange: (v: number | null) => void
  name: string
}) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.label}>
        {legend}
        {value ? <span className={styles.scoreLabel}>{labels[value]}</span> : null}
      </legend>
      <div className={styles.scores}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={cx(styles.score, value === n && styles.scoreActive)}>
            <input
              type="radio"
              name={name}
              className="visually-hidden"
              checked={value === n}
              onChange={() => {
                onChange(n)
              }}
              onClick={() => {
                if (value === n) onChange(null)
              }}
            />
            <span aria-hidden="true">{n}</span>
            <span className="visually-hidden">{labels[n]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
