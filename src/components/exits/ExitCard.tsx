/**
 * One plan that needs a decision today.
 *
 * The card survives only for the plans the framework rates `urgent` or
 * `attention`. It is a card, and not a row, for the reason it always was: the
 * recommendation is a sentence, and a sentence in a column reads at the same
 * weight as the figures either side of it. What it no longer carries is the
 * justification — the six levels, the entry facts and the note are a click away
 * in `ExitPlanDialog`, because they are what you read *after* deciding, not
 * what you read to decide.
 *
 * Nothing here computes anything; every figure arrives decided from
 * `lib/exit/rules.ts`.
 */
import styles from './ExitCard.module.scss'
import { ExitFlags } from './ExitFlags'
import { ExitLadder } from './ExitLadder'
import { OpenPlanButton } from './OpenPlanButton'
import { AccountDot } from '~/components/AccountDot'
import { ACCOUNT_LABEL, money, moneySigned, qty, tone } from '~/components/format'
import { cx } from '~/lib/cx'
import type { ExitRuleRow } from '~/server/exit'

export function ExitCard({
  row,
  onOpen,
  /** The phone form: no facts row, the ladder under the sentence instead. */
  compact = false,
}: {
  row: ExitRuleRow
  onOpen: (row: ExitRuleRow) => void
  compact?: boolean
}) {
  const severity = cx(
    row.actionSeverity === 'urgent' && styles.urgent,
    row.actionSeverity === 'attention' && styles.attention,
  )

  if (compact) {
    return (
      <article className={cx(styles.card, styles.compact, severity)}>
        <OpenPlanButton row={row} onOpen={onOpen} />

        <span className={styles.identity}>
          <AccountDot accountType={row.accountType} />
          <span className={styles.compactName}>
            {row.symbol} {row.name}
          </span>
        </span>

        <p className={cx(styles.compactAction, styles[row.actionSeverity])}>{row.actionMessage}</p>

        <ExitLadder row={row} className={styles.compactLadder} />

        {/* The three prices the sentence names, in the order they sit on the
            ladder above — the phone has no room for the facts row. */}
        <span className={styles.compactEnds}>
          <span>{money(row.currentStop, row.currency)} stop</span>
          <span>{money(row.currentPrice, row.currency)} now</span>
          <span>{money(row.target1, row.currency)} T1</span>
        </span>
      </article>
    )
  }

  return (
    <article className={cx(styles.card, severity)}>
      <OpenPlanButton row={row} onOpen={onOpen} />

      <div className={styles.head}>
        <span className={styles.identity}>
          <AccountDot accountType={row.accountType} />
          <span className={styles.symbol}>{row.symbol}</span>
          <span className={styles.name}>{row.name}</span>
          <span className={styles.account}>· {ACCOUNT_LABEL[row.accountType] ?? row.accountType}</span>
        </span>
        <ExitFlags row={row} />
      </div>

      <p className={cx(styles.action, styles[row.actionSeverity])}>{row.actionMessage}</p>

      <div className={styles.meta}>
        <ExitLadder row={row} ends className={styles.ladder} />

        <dl className={styles.facts}>
          <div>
            <dt>Current</dt>
            <dd>{money(row.currentPrice, row.currency)}</dd>
          </div>
          <div>
            <dt>Eff. stop</dt>
            <dd className={styles.loss}>{money(row.currentStop, row.currency)}</dd>
          </div>
          <div>
            <dt>Target 1</dt>
            <dd className={styles.profit}>{money(row.target1, row.currency)}</dd>
          </div>
          <div>
            <dt>Shares</dt>
            <dd>
              {qty(row.sharesRemaining)} / {qty(row.totalShares)}
            </dd>
          </div>
          <div>
            <dt>Unrealized</dt>
            <dd className={styles[tone(row.unrealizedTotal)]}>
              {moneySigned(row.unrealizedTotal, row.currency)}
            </dd>
          </div>
        </dl>

        {/* The affordance only; `OpenPlanButton` is the control, and announcing
            both would offer the same action twice. */}
        <span className={styles.details} aria-hidden="true">
          Details →
        </span>
      </div>
    </article>
  )
}
