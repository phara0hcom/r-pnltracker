/**
 * One day: its trades, each with a journal of its own, and the journal for
 * the day as a whole.
 *
 * Built on Radix Dialog, which supplies focus trapping, Escape-to-close, and
 * `aria-modal` — the parts of a modal that are easy to get subtly wrong by hand.
 * The browser's Back closes it too, and Forward does not bring it back — see
 * `useDialogHistory`.
 *
 * A desktop gets a centred dialog with the trades as a table, their figures in
 * columns. A phone gets a full-screen sheet: the day in three figures, a card
 * per trade, and Save within reach of a thumb at the bottom.
 *
 * Account names appear on a trade only when the day spans more than one
 * account — under the 特定 filter, or on a day in one account, they would
 * repeat one word down every row.
 *
 * Saving closes the dialog immediately and the day square updates from the
 * optimistic cache write, so there is no pending state to show here — the round
 * trip stores text the user has already read back on the calendar.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { longDate, weekdayDayMonth } from './dayText'
import { MOOD_LABELS, MOTIVATION_LABELS } from './MoodFace'
import styles from './NoteDialog.module.scss'
import { ScoreGroup } from './ScoreGroup'
import { isOpening, judgedBy, TRADE_COLUMNS, TradeCard, TradeTableRows, unitPrice } from './TradeJournalRow'
import { ACCOUNT_LABEL, tone, yen, yenSigned } from '~/components/format'
import { CloseIcon } from '~/components/icons/CloseIcon'
import { MarketInline } from '~/components/pnl/MarketSplit'
import { DayOrderList, type DayOrderItem } from '~/components/trades/DayOrderList'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { TagInput, withDraft } from '~/components/ui/TagInput'
import { useDialogHistory } from '~/components/ui/useDialogHistory'
import { useIsMobile } from '~/components/ui/useIsMobile'
import { cx } from '~/lib/cx'
import type { AccountFilter } from '~/lib/domain/types'
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
  price: unitPrice(trade.unitPrice, trade.currency, trade.assetClass),
})

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`

/** `特定 and NISA 成長`, `A, B and C`. */
function listOf(words: string[]): string {
  if (words.length < 2) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`
}

/** How a day's closes went: counted by the figure each is judged by. */
function outcomes(day: CalendarDay) {
  const closes = day.trades.filter((trade) => !isOpening(trade))
  return {
    closes: closes.length,
    opens: day.trades.length - closes.length,
    won: closes.filter((trade) => tone(judgedBy(trade)) === 'profit').length,
    lost: closes.filter((trade) => tone(judgedBy(trade)) === 'loss').length,
  }
}

/**
 * What the day came to, in words: how many trades, how the closes went, and
 * which accounts — the last only where the filter does not already say it.
 */
function describe(day: CalendarDay, accounts: string[], scope: AccountFilter): string {
  if (day.tradeCount === 0) return 'No trades'
  const { closes, won, lost } = outcomes(day)
  const outcome =
    closes === 0
      ? 'no closes'
      : won === closes
        ? `${plural(closes, 'close')}, ${closes === 1 ? 'won' : 'all won'}`
        : lost === closes
          ? `${plural(closes, 'close')}, ${closes === 1 ? 'lost' : 'all lost'}`
          : `${plural(closes, 'close')}: ${String(won)} won, ${String(lost)} lost`
  const labels = accounts.map((account) => ACCOUNT_LABEL[account] ?? account)
  const where = labels.length > 1 ? listOf(labels) : scope === 'SPECIFIC' ? null : `all in ${labels.join('')}`
  return [plural(day.tradeCount, 'trade'), outcome, where].filter((part) => part != null).join(' · ')
}

const toneClass = (value: string | null | undefined) => {
  const name = tone(value)
  return name === 'flat' ? undefined : styles[name]
}

export function NoteDialog({
  day,
  scope,
  onClose,
  onSave,
  onDelete,
}: {
  day: CalendarDay
  /** The account filter the day is shown under. */
  scope: AccountFilter
  onClose: () => void
  onSave: (note: NotePayload) => void
  onDelete: (date: string) => void
}) {
  useDialogHistory(true, onClose)
  const isMobile = useIsMobile()

  const [title, setTitle] = useState(day.note?.title ?? '')
  const [body, setBody] = useState(day.note?.body ?? '')
  const [mood, setMood] = useState<number | null>(day.note?.mood ?? null)
  const [motivation, setMotivation] = useState<number | null>(day.note?.motivation ?? null)
  const [tags, setTags] = useState<string[]>(day.note?.tags ?? [])
  const [tagDraft, setTagDraft] = useState('')

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
      tags: withDraft(tags, tagDraft),
    })
  }

  const accounts = [...new Set(day.trades.map((trade) => trade.accountType))]
  const showAccount = accounts.length > 1
  const { closes, opens, won, lost } = outcomes(day)
  const meta = describe(day, accounts, scope)
  const hasUs = day.trades.some((trade) => trade.realizedUsd != null)

  const orderHint = ordering
    ? 'First trade of the day at the top'
    : day.ordered
      ? 'In the order you set'
      : 'Grouped by instrument — exports carry no execution time'

  const trades =
    day.trades.length === 0 ? null : (
      <section className={styles.section} aria-labelledby="day-trades">
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitles}>
            <h3 id="day-trades" className={styles.sectionTitle}>
              Trades
            </h3>
            <span className={styles.sectionHint}>{orderHint}</span>
          </div>
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
              label={`Order of trades on ${weekdayDayMonth(day.date)}`}
              showAccount={showAccount}
            />
            <div className={styles.orderActions}>
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
              <span className={styles.orderError} role="status">
                {orderError ?? (saveOrder.isError ? 'Could not save the order.' : '')}
              </span>
            </div>
          </>
        ) : isMobile ? (
          <ul className={styles.cards}>
            {day.trades.map((trade) => (
              <TradeCard key={trade.id} trade={trade} showAccount={showAccount} />
            ))}
          </ul>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="visually-hidden">Trades on {weekdayDayMonth(day.date)}</caption>
              <colgroup>
                <col />
                <col className={styles.colSize} />
                <col className={styles.colCash} />
                <col className={styles.colRealized} />
                <col className={styles.colReturn} />
                <col className={styles.colJournal} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Instrument</th>
                  <th scope="col" data-numeric="">
                    Qty × price
                  </th>
                  <th scope="col" data-numeric="">
                    Cash
                  </th>
                  <th scope="col" data-numeric="">
                    Realized
                  </th>
                  <th scope="col" data-numeric="">
                    Return
                  </th>
                  <th scope="col" data-numeric="">
                    Journal
                  </th>
                </tr>
              </thead>
              {day.trades.map((trade) => (
                <TradeTableRows key={trade.id} trade={trade} showAccount={showAccount} />
              ))}
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>
                    Day total
                  </th>
                  <td data-numeric="" className={styles.cashTotal}>
                    {day.receivedJpy === '0' ? null : <span>{yen(day.receivedJpy)} in</span>}
                    {day.paidJpy === '0' ? null : <span>{yen(day.paidJpy)} out</span>}
                  </td>
                  <td data-numeric="" className={cx(styles.dayRealized, toneClass(day.realizedJpy))}>
                    {day.realizedJpy == null ? '—' : yenSigned(day.realizedJpy)}
                  </td>
                  <td colSpan={TRADE_COLUMNS - 4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {hasUs && !ordering ? (
          <p className={styles.footnote}>
            US closes are in dollars on price, before commission, as Rakuten shows them. The yen
            beside each includes the currency move, as the day&apos;s total does.
          </p>
        ) : null}
      </section>
    )

  const journal = (
    <section className={styles.journal} aria-labelledby="day-journal">
      <div className={styles.feelings}>
        <h3 id="day-journal" className={styles.sectionTitle}>
          How the day felt
        </h3>
        <ScoreGroup legend="Mood" labels={MOOD_LABELS} value={mood} onChange={setMood} name="mood" />
        <ScoreGroup
          legend="Motivation"
          labels={MOTIVATION_LABELS}
          value={motivation}
          onChange={setMotivation}
          name="motivation"
        />
      </div>
      <div className={styles.fields}>
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
            rows={isMobile ? 4 : 3}
            value={body}
            onChange={(event) => {
              setBody(event.target.value)
            }}
            placeholder="What did you do, and why? What would you repeat or avoid?"
          />
        </label>
        <div className={styles.field}>
          <span id="day-tags" className={styles.label}>
            Tags
          </span>
          <TagInput
            tags={tags}
            draft={tagDraft}
            onChange={setTags}
            onDraftChange={setTagDraft}
            labelledBy="day-tags"
            placeholder="plan-followed, late-exit, news-driven"
          />
        </div>
        {isMobile && day.note ? (
          <ConfirmButton
            className={styles.deleteEntry}
            variant="text"
            confirmLabel="Delete this entry?"
            onConfirm={() => {
              onDelete(day.date)
            }}
          >
            Delete journal entry
          </ConfirmButton>
        ) : null}
      </div>
    </section>
  )

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
          className={cx(styles.content, isMobile && styles.sheet)}
          onKeyDown={(event) => {
            // Cmd/Ctrl+Enter saves — Enter alone must stay usable in the textarea.
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
          }}
        >
          <div className={styles.head}>
            <div className={styles.heading}>
              <Dialog.Title className={styles.title}>
                {isMobile ? `${weekdayDayMonth(day.date)} ${day.date.slice(0, 4)}` : longDate(day.date)}
              </Dialog.Title>
              <Dialog.Description className={styles.meta}>{meta}</Dialog.Description>
            </div>
            {!isMobile && day.markets ? (
              <div className={styles.headFigure}>
                <span className={styles.figureLabel}>Realized</span>
                <span className={cx(styles.headRealized, toneClass(day.realizedJpy))}>
                  {yenSigned(day.realizedJpy)}
                </span>
                {day.markets.usdRealizedUsd == null ? null : (
                  <MarketInline split={day.markets} className={styles.headSplit} />
                )}
              </div>
            ) : null}
            <Dialog.Close className={styles.close} aria-label="Close">
              <CloseIcon />
            </Dialog.Close>
          </div>

          <div className={styles.body}>
            {isMobile && day.tradeCount > 0 ? (
              <>
                <dl className={styles.strip}>
                  <div className={styles.stripCell}>
                    <dt>Realized</dt>
                    <dd className={cx(styles.stripValue, toneClass(day.realizedJpy))}>
                      {day.realizedJpy == null ? '—' : yenSigned(day.realizedJpy)}
                    </dd>
                    <dd className={styles.stripNote}>
                      {day.realizedJpy == null ? 'nothing sold' : 'in yen, currency moves included'}
                    </dd>
                  </div>
                  <div className={styles.stripCell}>
                    <dt>Closes</dt>
                    <dd className={styles.stripValue}>{closes}</dd>
                    <dd className={styles.stripNote}>
                      {closes === 0 ? 'none' : `${String(won)} won · ${String(lost)} lost`}
                    </dd>
                  </div>
                  <div className={styles.stripCell}>
                    <dt>Opens</dt>
                    <dd className={styles.stripValue}>{opens}</dd>
                    <dd className={styles.stripNote}>{opens === 0 ? 'none' : 'bought'}</dd>
                  </div>
                </dl>
                {day.markets?.usdRealizedUsd == null ? null : (
                  <MarketInline split={day.markets} className={styles.stripSplit} />
                )}
              </>
            ) : null}
            {trades}
            {journal}
          </div>

          <div className={styles.footer}>
            {isMobile ? null : day.note ? (
              <ConfirmButton
                className={styles.deleteEntry}
                variant="text"
                confirmLabel="Delete this entry?"
                onConfirm={() => {
                  onDelete(day.date)
                }}
              >
                Delete entry
              </ConfirmButton>
            ) : (
              <span />
            )}
            <div className={styles.footerActions}>
              {isMobile ? null : <span className={styles.hint}>⌘/Ctrl + Enter saves</span>}
              <Dialog.Close className={styles.button}>Cancel</Dialog.Close>
              <button type="button" className={cx(styles.button, styles.primary)} onClick={submit}>
                Save entry
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
