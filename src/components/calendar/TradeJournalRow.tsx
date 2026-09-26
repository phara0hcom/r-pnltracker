/**
 * One trade inside the calendar day dialog, with its own memo and motivation.
 *
 * Per-trade rather than per-day on purpose: a good day can contain one
 * impulsive trade, and folding that into a single daily score averages away
 * exactly the signal worth keeping.
 *
 * Two layouts over one journal: a table row on a desktop, where the figures
 * line up in columns, and a two-line card on a phone, where they cannot. Both
 * open the same editor under the trade.
 *
 * Saving here never touches the trade's figures — it goes through a journal-only
 * server function, so a note can't accidentally mark a row as hand-corrected.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { MOTIVATION_LABELS } from './MoodFace'
import { ScoreGroup } from './ScoreGroup'
import styles from './TradeJournalRow.module.scss'
import { AccountDot } from '~/components/AccountDot'
import { ACCOUNT_LABEL, moneySigned, pctSigned, qty, tone, yen, yenSigned } from '~/components/format'
import { CloseIcon } from '~/components/icons/CloseIcon'
import { PenIcon } from '~/components/icons/PenIcon'
import { InstrumentLink } from '~/components/InstrumentLink'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { withTradeJournal } from '~/lib/calendarPatch'
import { cx } from '~/lib/cx'
import { OPENING_SIDES } from '~/lib/domain/types'
import { reportError } from '~/lib/observability/report'
import { saveTradeJournal } from '~/server/notes'
import type { CalendarMonth, CalendarTrade } from '~/server/screens'

// ── What a trade reads as ───────────────────────────────────────────────────

export const isOpening = (trade: Pick<CalendarTrade, 'side'>) => OPENING_SIDES.includes(trade.side)

/**
 * The figure a close is judged by: dollars for a US close, as Rakuten shows
 * it, yen for anything else. Its sign decides won or lost.
 */
export const judgedBy = (trade: CalendarTrade): string | null => trade.realizedUsd ?? trade.realizedJpy

/** A price in its own currency, as Rakuten quotes it. Funds arrive per 10,000 口. */
export function unitPrice(amount: string, currency: string, assetClass: string): string {
  const figure =
    currency === 'USD'
      ? `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
      : `¥${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 4 })}`
  return assetClass === 'FUND' ? `${figure}/万口` : figure
}

/** `300 × ¥3,905`, or for a fund `52,839 口 at ¥37,410/万口`. */
export function sizeText(trade: CalendarTrade): string {
  const price = unitPrice(trade.unitPrice, trade.currency, trade.assetClass)
  return trade.assetClass === 'FUND' ? `${qty(trade.quantity)} 口 at ${price}` : `${qty(trade.quantity)} × ${price}`
}

/**
 * No lot is identified — 移動平均法 pools the units — so this is the pool's
 * weighted-average cost at the moment of the sale, which is what the realized
 * figure was actually measured against.
 */
const avgCostTitle = (trade: CalendarTrade, avg: string) =>
  `Closed against a weighted-average cost of ${avg}${
    trade.holdingDays == null
      ? ''
      : `, held ${String(trade.holdingDays)} day${trade.holdingDays === 1 ? '' : 's'} on average`
  }. Moving-average cost basis pools units, so no single buy is matched to this sale.`

const SIDE_CLASS: Record<string, string | undefined> = {
  BUY: styles.sideBuy,
  REINVEST: styles.sideBuy,
  SELL: styles.sideSell,
  REDEEM: styles.sideSell,
}

function SideBadge({ side }: { side: string }) {
  return <span className={cx(styles.side, SIDE_CLASS[side])}>{side}</span>
}

function AccountTag({ accountType }: { accountType: string }) {
  return (
    <span className={styles.account}>
      <AccountDot accountType={accountType} />
      {ACCOUNT_LABEL[accountType] ?? accountType}
    </span>
  )
}

const toneClass = (value: string | number | null | undefined) => {
  const name = tone(value)
  return name === 'flat' ? undefined : styles[name]
}

const cashDirection = (trade: CalendarTrade) =>
  trade.side === 'REINVEST' ? 'reinvested' : isOpening(trade) ? 'paid' : 'received'

/** A US close's dollars with the yen under them; any other close in yen. */
function Realized({ trade }: { trade: CalendarTrade }) {
  if (trade.realizedJpy == null) return <span className={styles.none}>—</span>
  if (trade.realizedUsd == null) return <>{yenSigned(trade.realizedJpy)}</>
  return (
    <span
      title={[
        trade.netUsd == null ? null : `${moneySigned(trade.netUsd, 'USD')} after the sell commission as well`,
        `${yenSigned(trade.realizedJpy)} in yen, the currency move included`,
      ]
        .filter((line) => line != null)
        .join('\n')}
    >
      {moneySigned(trade.realizedUsd, 'USD')}
      <span className={styles.subline}>({yenSigned(trade.realizedJpy)})</span>
    </span>
  )
}

// ── The journal ─────────────────────────────────────────────────────────────

function useTradeJournal(trade: CalendarTrade) {
  const queryClient = useQueryClient()

  /** Last persisted values — what Cancel reverts to and what "dirty" compares against. */
  const [savedMemo, setSavedMemo] = useState(trade.memo ?? '')
  const [savedMotivation, setSavedMotivation] = useState<number | null>(trade.motivation)

  const [memo, setMemo] = useState(savedMemo)
  const [motivation, setMotivation] = useState<number | null>(savedMotivation)
  const [open, setOpen] = useState(false)

  const hasJournal = Boolean(savedMemo) || savedMotivation != null
  const dirty = memo.trim() !== savedMemo.trim() || motivation !== savedMotivation

  /**
   * Write this trade's journal into every cached month.
   *
   * Local state alone is not enough: the day dialog is re-rendered from the
   * cached calendar query, which has a 5-minute staleTime. Reopening the day
   * would remount this row with the pre-save memo and look like a lost edit.
   * Every cached month is patched because the row does not know which one the
   * open dialog was drawn from.
   */
  const patchCache = (journal: { memo: string | null; motivation: number | null }) => {
    queryClient.setQueriesData<CalendarMonth>({ queryKey: ['calendar'] }, (month) =>
      withTradeJournal(month, trade.id, journal),
    )
  }

  const save = useMutation({
    mutationFn: (journal: { memo: string | null; motivation: number | null }) =>
      saveTradeJournal({ data: { tradeId: trade.id, ...journal } }),
    // Applied before the request, not after it: the server only stores this text
    // back, so waiting on the round trip would show a spinner over a result that
    // is already known.
    onMutate: async (journal) => {
      await queryClient.cancelQueries({ queryKey: ['calendar'] })
      const previous = { memo: savedMemo || null, motivation: savedMotivation }

      setSavedMemo(journal.memo ?? '')
      setSavedMotivation(journal.motivation)
      patchCache(journal)
      return previous
    },
    // Re-applies the previous values rather than restoring a snapshot: a day
    // dialog runs one of these mutations per trade, so a snapshot taken before
    // this save would also wipe a sibling row saved while it was in flight.
    onError: (error, _journal, previous) => {
      reportError(error, { mutation: 'saveTradeJournal' })
      if (!previous) return
      setSavedMemo(previous.memo ?? '')
      setSavedMotivation(previous.motivation)
      setMemo(previous.memo ?? '')
      setMotivation(previous.motivation)
      patchCache(previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  })

  return {
    memo,
    setMemo,
    motivation,
    setMotivation,
    open,
    savedMemo,
    savedMotivation,
    hasJournal,
    dirty,
    failed: save.isError,
    openEditor: () => {
      setOpen(true)
    },
    /** Save and collapse. */
    commit: () => {
      save.mutate({ memo: memo.trim() || null, motivation })
      setOpen(false)
    },
    /** Discard edits and collapse. Never writes. */
    cancel: () => {
      setMemo(savedMemo)
      setMotivation(savedMotivation)
      setOpen(false)
    },
    /** Wipe the stored journal for this trade. */
    clear: () => {
      setMemo('')
      setMotivation(null)
      setOpen(false)
      save.mutate({ memo: null, motivation: null })
    },
  }
}

type Journal = ReturnType<typeof useTradeJournal>

const noteLabel = (trade: CalendarTrade, journal: Journal) =>
  `${journal.open ? 'Close note for' : journal.hasJournal ? 'Edit note for' : 'Add a note for'} ${trade.side.toLowerCase()} ${trade.symbol}`

/**
 * A saved note stays readable without reopening the editor, which is the
 * whole point of writing it down. Pressing it opens the editor.
 */
function SavedNote({ journal }: { journal: Journal }) {
  return (
    <>
      {journal.failed ? (
        <p className={styles.failed} role="alert">
          Could not save that note — it has been put back as it was.
        </p>
      ) : null}
      {journal.hasJournal ? (
        <button type="button" className={styles.saved} onClick={journal.openEditor}>
          {journal.savedMotivation != null ? (
            <span className={styles.savedScore}>
              Motivation {journal.savedMotivation}/5{journal.savedMemo ? ' · ' : ''}
            </span>
          ) : null}
          {journal.savedMemo ? <span className={styles.savedMemo}>{journal.savedMemo}</span> : null}
        </button>
      ) : null}
    </>
  )
}

function Editor({ trade, journal }: { trade: CalendarTrade; journal: Journal }) {
  return (
    <div className={styles.editor}>
      <ScoreGroup
        legend="Motivation for this trade"
        labels={MOTIVATION_LABELS}
        value={journal.motivation}
        onChange={journal.setMotivation}
        name={`motivation-${trade.id}`}
      />

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Note</span>
        <textarea
          className={styles.memoInput}
          rows={2}
          value={journal.memo}
          placeholder="Why this trade? What would you repeat or avoid?"
          onChange={(event) => {
            journal.setMemo(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              // The day dialog binds the same chord on its content element.
              // Without this the event bubbles on, saving a blank day-level
              // note and closing the dialog out from under this trade.
              event.stopPropagation()
              journal.commit()
            }
          }}
        />
      </label>

      <div className={styles.actions}>
        {/* Only once there is something to destroy. */}
        {journal.hasJournal ? (
          <ConfirmButton onConfirm={journal.clear} confirmLabel="Delete note?" variant="text" className={styles.delete}>
            Delete note
          </ConfirmButton>
        ) : (
          <span />
        )}
        <span className={styles.actionGroup}>
          <button type="button" className={styles.button} onClick={journal.cancel}>
            Cancel
          </button>
          <button
            type="button"
            className={cx(styles.button, styles.primary)}
            disabled={!journal.dirty}
            onClick={journal.commit}
          >
            Save note
          </button>
        </span>
      </div>
    </div>
  )
}

// ── Desktop: rows of the day's table ────────────────────────────────────────

/** How many columns the day's table has — the memo and editor rows span them. */
export const TRADE_COLUMNS = 6

export function TradeTableRows({ trade, showAccount }: { trade: CalendarTrade; showAccount: boolean }) {
  const journal = useTradeJournal(trade)
  const opening = isOpening(trade)
  const avg = trade.entryPrice == null ? null : unitPrice(trade.entryPrice, trade.currency, trade.assetClass)
  const tint = toneClass(judgedBy(trade))

  return (
    <tbody className={styles.trade}>
      <tr className={styles.main}>
        <td>
          <span className={styles.instrument}>
            <SideBadge side={trade.side} />
            <span className={styles.who}>
              <InstrumentLink symbol={trade.symbol} name={trade.name} assetClass={trade.assetClass} size="compact" />
              {showAccount ? <AccountTag accountType={trade.accountType} /> : null}
            </span>
          </span>
        </td>
        <td data-numeric="">
          {sizeText(trade)}
          {avg ? (
            <span className={styles.subline} title={avgCostTitle(trade, avg)}>
              avg cost {avg}
            </span>
          ) : null}
        </td>
        <td data-numeric="">
          {yen(trade.amountJpy)}
          <span className={styles.subline}>{cashDirection(trade)}</span>
        </td>
        <td data-numeric="" className={cx(styles.realized, tint)}>
          {opening ? null : <Realized trade={trade} />}
        </td>
        <td data-numeric="" className={tint}>
          {opening ? null : pctSigned(trade.returnPct)}
        </td>
        <td className={styles.journalCell}>
          <button
            type="button"
            className={cx(styles.noteButton, (journal.hasJournal || journal.open) && styles.noteButtonActive)}
            aria-expanded={journal.open}
            aria-label={noteLabel(trade, journal)}
            onClick={journal.open ? journal.cancel : journal.openEditor}
          >
            {journal.open ? <CloseIcon /> : <PenIcon />}
            <span aria-hidden="true">{journal.open ? 'Close' : journal.hasJournal ? 'Edit' : 'Add'}</span>
          </button>
        </td>
      </tr>
      {!journal.open && (journal.hasJournal || journal.failed) ? (
        <tr className={styles.noteRow}>
          <td colSpan={TRADE_COLUMNS}>
            <SavedNote journal={journal} />
          </td>
        </tr>
      ) : null}
      {journal.open ? (
        <tr className={styles.noteRow}>
          <td colSpan={TRADE_COLUMNS}>
            <Editor trade={trade} journal={journal} />
          </td>
        </tr>
      ) : null}
    </tbody>
  )
}

// ── Phone: a card per trade ─────────────────────────────────────────────────

/**
 * What it is and what it came to on the first line, how many at what on the
 * second: a buy leads with the cash it took, a close with its result.
 */
export function TradeCard({ trade, showAccount }: { trade: CalendarTrade; showAccount: boolean }) {
  const journal = useTradeJournal(trade)
  const opening = isOpening(trade)
  const avg = trade.entryPrice == null ? null : unitPrice(trade.entryPrice, trade.currency, trade.assetClass)
  const tint = toneClass(judgedBy(trade))
  const isFund = trade.assetClass === 'FUND'

  return (
    <li className={styles.card}>
      <span className={styles.cardWho}>
        <SideBadge side={trade.side} />
        <span className={cx(styles.cardSymbol, isFund && styles.cardSymbolFund)}>{trade.symbol}</span>
        {isFund ? null : <span className={styles.cardName}>{trade.name}</span>}
      </span>
      <span className={cx(styles.cardFigure, !opening && tint)}>
        {opening ? (
          yen(trade.amountJpy)
        ) : trade.realizedUsd != null ? (
          moneySigned(trade.realizedUsd, 'USD')
        ) : trade.realizedJpy != null ? (
          yenSigned(trade.realizedJpy)
        ) : (
          '—'
        )}
      </span>
      <button
        type="button"
        className={cx(
          styles.cardNote,
          journal.hasJournal && styles.noteButtonActive,
          journal.open && styles.cardNoteOpen,
        )}
        aria-expanded={journal.open}
        aria-label={noteLabel(trade, journal)}
        onClick={journal.open ? journal.cancel : journal.openEditor}
      >
        {journal.open ? <CloseIcon /> : <PenIcon />}
      </button>
      <span className={styles.cardLine}>
        {showAccount ? <AccountTag accountType={trade.accountType} /> : null}
        <span className={styles.cardSize}>
          {sizeText(trade)}
          {avg ? ` · avg ${avg}` : ''}
        </span>
      </span>
      <span className={cx(styles.cardSub, opening ? styles.none : tint)}>
        {opening ? cashDirection(trade) : pctSigned(trade.returnPct)}
      </span>
      {!opening && trade.realizedUsd != null && trade.realizedJpy != null ? (
        <span className={styles.cardExtra}>
          {yenSigned(trade.realizedJpy)} in yen, the currency move included
        </span>
      ) : null}
      {!journal.open && (journal.hasJournal || journal.failed) ? (
        <div className={styles.cardMemo}>
          <SavedNote journal={journal} />
        </div>
      ) : null}
      {journal.open ? (
        <div className={styles.cardEditor}>
          <Editor trade={trade} journal={journal} />
        </div>
      ) : null}
    </li>
  )
}
