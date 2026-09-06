/**
 * The activator that makes a whole card or row open its plan.
 *
 * A real button stretched over its container rather than a `role="button"` on
 * the container itself. On the table that is the difference between a table of
 * rows and a table of buttons — `role="button"` on a `<tr>` costs the row its
 * place in the grid, so the figures either side of the instrument stop being
 * readable cell by cell. Stretching a button over the row instead leaves the
 * table a table, and still gives the pointer the whole row as a target.
 *
 * The container must be positioned; for a `<tr>` that means `position:
 * relative` on the row, which is what lets a button inside a `<td>` cover all
 * of it. The button's own focus ring then draws around the entire container,
 * so there is no second element to keep in step.
 */
import styles from './OpenPlanButton.module.scss'
import type { ExitRuleRow } from '~/server/exit'

export function OpenPlanButton({
  row,
  onOpen,
}: {
  row: ExitRuleRow
  onOpen: (row: ExitRuleRow) => void
}) {
  return (
    <button
      type="button"
      className={styles.open}
      onClick={() => {
        onOpen(row)
      }}
    >
      {/* The card or row it covers is already read out around it, so the label
          only has to say which plan opens and that something opens at all. */}
      <span className="visually-hidden">
        Full plan for {row.symbol} {row.name}
      </span>
    </button>
  )
}
