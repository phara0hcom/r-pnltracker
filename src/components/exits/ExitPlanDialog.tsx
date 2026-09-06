/**
 * One plan in full, read-only.
 *
 * This is the body the list used to carry on every card. The argument for a
 * card over a table row still holds — the framework's output is a decision plus
 * the levels that justify it, and a row flattens those to equal weight — but it
 * only holds for the plans that *have* a decision to justify. For the rest the
 * six levels were being paid for eight times over on a screen whose question is
 * "is there anything I have to do?", so they moved here, one plan at a time.
 *
 * Not `ExitRuleDialog`: that one is the create/edit form. Nothing here is an
 * input, and nothing here computes — every level, flag and the recommendation
 * itself arrive already decided from `lib/exit/rules.ts`.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useRef } from 'react'
import { ExitFlags } from './ExitFlags'
import { ExitLadder } from './ExitLadder'
import styles from './ExitPlanDialog.module.scss'
import { AccountDot } from '~/components/AccountDot'
import { ACCOUNT_LABEL, ASSET_LABEL, money, moneySigned, qty, tone } from '~/components/format'
import { InstrumentLink } from '~/components/InstrumentLink'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { cx } from '~/lib/cx'
import type { ExitRuleRow } from '~/server/exit'

function Level({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string
  value: string
  hint?: string
  emphasis?: 'stop' | 'target' | 'live'
}) {
  return (
    <div className={styles.level}>
      <span className={styles.levelLabel}>{label}</span>
      <span
        className={cx(
          styles.levelValue,
          emphasis === 'stop' && styles.stopValue,
          emphasis === 'target' && styles.targetValue,
          emphasis === 'live' && styles.liveValue,
        )}
      >
        {value}
      </span>
      {hint ? <span className={styles.levelHint}>{hint}</span> : null}
    </div>
  )
}

export function ExitPlanDialog({
  row,
  onClose,
  onArchive,
  onEdit,
}: {
  /** The plan to show; `null` closes the dialog. */
  row: ExitRuleRow | null
  onClose: () => void
  onArchive: (id: string) => void
  onEdit: (row: ExitRuleRow) => void
}) {
  /*
   * Set while Edit is handing this dialog over to `ExitRuleDialog`.
   *
   * Radix returns focus to whatever opened a dialog when it closes, which is
   * right for every close but this one: the form opens in the same commit, and
   * the two would race for focus with the card that was clicked liable to win.
   * Suppressing the restore leaves the form's own focus management unopposed.
   */
  const handingOff = useRef(false)

  return (
    <Dialog.Root
      open={row !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.content}
          onCloseAutoFocus={(event) => {
            if (!handingOff.current) return
            handingOff.current = false
            event.preventDefault()
          }}
        >
          {row === null ? null : (
            <>
              <header className={styles.head}>
                <div className={styles.identity}>
                  <Dialog.Title className={styles.title}>
                    <InstrumentLink
                      symbol={row.symbol}
                      name={row.name}
                      assetClass={row.assetClass}
                    />
                  </Dialog.Title>
                  <span className={styles.account}>
                    <AccountDot accountType={row.accountType} />
                    {ACCOUNT_LABEL[row.accountType] ?? row.accountType} ·{' '}
                    {ASSET_LABEL[row.assetClass] ?? row.assetClass}
                  </span>
                </div>

                <div className={styles.headActions}>
                  <ExitFlags row={row} />
                  <Dialog.Close className={styles.close} aria-label="Close">
                    ×
                  </Dialog.Close>
                </div>
              </header>

              {/*
                The recommendation is the whole point of the screen, so it sits
                above the figures rather than under them — the levels are the
                justification, not the headline. It doubles as the dialog's
                description, which is the sentence a screen reader should hear
                first on opening.
              */}
              <Dialog.Description className={cx(styles.action, styles[row.actionSeverity])}>
                {row.actionMessage}
              </Dialog.Description>

              <ExitLadder row={row} ends size="lg" />

              <div className={styles.levels}>
                <Level
                  label="Current"
                  value={money(row.currentPrice, row.currency)}
                  hint={row.lastBarDate ?? 'no feed'}
                  emphasis="live"
                />
                <Level
                  label="Effective stop"
                  value={money(row.currentStop, row.currency)}
                  hint={row.target1Hit ? 'breakeven or trail' : 'initial'}
                  emphasis="stop"
                />
                <Level
                  label="Target 1"
                  value={money(row.target1, row.currency)}
                  hint={row.target1HitDate ?? `${money(row.riskPerShare, row.currency)} R`}
                  emphasis="target"
                />
                <Level
                  label="Initial stop"
                  value={money(row.initialStop, row.currency)}
                  hint={row.stopFromSupportOnly ? 'support only — no entry ATR' : 'locked at entry'}
                />
                <Level
                  label="Trailing stop"
                  value={
                    row.trailingStop === null ? 'Not active' : money(row.trailingStop, row.currency)
                  }
                  hint={
                    row.trailingActive
                      ? `high ${money(row.highestClose, row.currency)}`
                      : 'after Target 1'
                  }
                />
                <Level
                  label="Partial size"
                  value={Number(row.partialExitShares) === 0 ? '—' : `${qty(row.partialExitShares)} sh`}
                  hint={row.partialTaken ? 'already taken' : `of ${qty(row.totalShares)}`}
                />
              </div>

              <footer className={styles.foot}>
                <dl className={styles.facts}>
                  <div>
                    <dt>Entry</dt>
                    <dd>
                      {money(row.entryPrice, row.currency)} · {row.entryDate}
                    </dd>
                  </div>
                  <div>
                    <dt>Shares</dt>
                    <dd>
                      {qty(row.sharesRemaining)} / {qty(row.totalShares)}
                    </dd>
                  </div>
                  <div>
                    <dt>Held</dt>
                    <dd>
                      {row.daysHeld}d · {row.tradingDaysHeld} sessions
                    </dd>
                  </div>
                  {row.rsi14 === null ? null : (
                    <div>
                      <dt>RSI / MACD·h</dt>
                      <dd>
                        {row.rsi14} · {row.macdHist}
                      </dd>
                    </div>
                  )}
                  {row.unrealizedTotal === null ? null : (
                    <div>
                      <dt>Unrealized</dt>
                      <dd className={styles[tone(row.unrealizedTotal)]}>
                        {moneySigned(row.unrealizedTotal, row.currency)}
                      </dd>
                    </div>
                  )}
                </dl>

                {/*
                  Both actions live here rather than on the card or the row.
                  Nesting them inside a click target that itself opens this
                  dialog is the nested-button problem, and moving them is what
                  lets the list be clickable at all.
                */}
                <div className={styles.actions}>
                  <ConfirmButton
                    size="small"
                    onConfirm={() => {
                      onArchive(row.id)
                    }}
                    title="Retire this exit plan"
                  >
                    Archive
                  </ConfirmButton>
                  <button
                    type="button"
                    className={styles.editButton}
                    onClick={() => {
                      handingOff.current = true
                      onEdit(row)
                    }}
                  >
                    Edit plan
                  </button>
                </div>
              </footer>

              {row.note ? <p className={styles.note}>{row.note}</p> : null}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
