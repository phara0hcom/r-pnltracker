/**
 * One plan the framework has nothing to say about.
 *
 * A row, and not a card, precisely because there is no decision to justify:
 * "hold, price is between the stop and Target 1" is the same sentence for every
 * one of these, and eight copies of it in eight cards is what buried the one
 * position that was actually stopped out. In a row the figures compare down the
 * column, which is the only reading these plans support.
 *
 * The whole row opens the plan — see `OpenPlanButton` for why that is a
 * stretched button rather than a role on the `<tr>`.
 */
import { ExitFlags } from './ExitFlags'
import { ExitLadder } from './ExitLadder'
import styles from './ExitPlanRow.module.scss'
import { OpenPlanButton } from './OpenPlanButton'
import { AccountDot } from '~/components/AccountDot'
import { money, moneySigned, tone } from '~/components/format'
import type { ExitRuleRow } from '~/server/exit'

export function ExitPlanRow({
  row,
  onOpen,
}: {
  row: ExitRuleRow
  onOpen: (row: ExitRuleRow) => void
}) {
  return (
    <tr className={styles.row}>
      <td className={styles.instrument}>
        <OpenPlanButton row={row} onOpen={onOpen} />
        <span className={styles.identity}>
          <AccountDot accountType={row.accountType} />
          <span className={styles.symbol}>{row.symbol}</span>
          <span className={styles.name}>{row.name}</span>
        </span>
      </td>
      <td>
        <ExitLadder row={row} className={styles.ladder} />
      </td>
      <td data-numeric className={styles.current}>
        {money(row.currentPrice, row.currency)}
      </td>
      <td data-numeric className={styles.stop}>
        {money(row.currentStop, row.currency)}
      </td>
      <td data-numeric className={styles.target}>
        {money(row.target1, row.currency)}
      </td>
      <td data-numeric className={styles[tone(row.unrealizedTotal)]}>
        {moneySigned(row.unrealizedTotal, row.currency)}
      </td>
      <td data-numeric className={styles.held}>
        {row.tradingDaysHeld} sessions
      </td>
      <td>
        <ExitFlags row={row} compact />
      </td>
    </tr>
  )
}
