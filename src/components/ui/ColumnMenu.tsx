/**
 * The ⋯ menu that chooses which of a table's columns are shown.
 *
 * Built on Radix DropdownMenu for the roving focus, typeahead and Escape
 * handling a checkbox menu needs. `onSelect` is prevented on each item so
 * ticking one column does not close the menu — trimming a table is usually
 * several decisions, not one.
 *
 * Only columns the user can actually act on are listed. A locked column is not
 * a choice, and neither is one a filter has pinned to a single value — offering
 * either would put an entry in the menu that changes nothing on screen.
 */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import styles from './ColumnMenu.module.scss'
import type { HiddenColumns, TableColumn } from '~/lib/table/columns'

export function ColumnMenu<K extends string>({
  columns,
  hidden,
  hiddenCount,
  redundant = [],
  onToggle,
  onReset,
  label = 'Choose columns',
}: {
  columns: readonly TableColumn<K>[]
  hidden: HiddenColumns
  /** Pinned to one value by an active filter, so not worth offering. */
  redundant?: HiddenColumns
  hiddenCount: number
  onToggle: (key: string) => void
  onReset: () => void
  /** Named per table, so two menus on one screen are distinguishable. */
  label?: string
}) {
  const hideable = columns.filter(
    (column) => column.locked !== true && !redundant.includes(column.key),
  )

  // Nothing left to choose — every column is locked or pinned by a filter. An
  // empty menu is worse than no menu, so the trigger goes too.
  if (hideable.length === 0) return null

  return (
    <DropdownMenu.Root>
      <span className={styles.triggerWrap}>
        <DropdownMenu.Trigger className={styles.trigger} aria-label={label}>
          <span aria-hidden="true">⋯</span>
        </DropdownMenu.Trigger>
        {hiddenCount > 0 ? (
          // Announced, not just drawn: a table missing three columns looks
          // broken rather than configured if nothing says so.
          <span className={styles.badge} title={`${String(hiddenCount)} columns hidden`}>
            {hiddenCount}
          </span>
        ) : null}
      </span>

      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.content} align="end" sideOffset={6}>
          <DropdownMenu.Label className={styles.label}>Columns</DropdownMenu.Label>

          {hideable.map((column) => {
            const shown = !hidden.includes(column.key)
            return (
              <DropdownMenu.CheckboxItem
                key={column.key}
                className={styles.item}
                checked={shown}
                onSelect={(event) => {
                  // Keep the menu open; hiding columns is rarely a single choice.
                  event.preventDefault()
                }}
                onCheckedChange={() => {
                  onToggle(column.key)
                }}
              >
                <span className={styles.check} aria-hidden="true">
                  {shown ? '✓' : ''}
                </span>
                {column.label}
              </DropdownMenu.CheckboxItem>
            )
          })}

          {hiddenCount > 0 ? (
            <>
              <DropdownMenu.Separator className={styles.separator} />
              <DropdownMenu.Item className={styles.reset} onSelect={onReset}>
                Show all columns
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
