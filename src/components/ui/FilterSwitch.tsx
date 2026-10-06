/**
 * A segmented switch for a screen-wide filter, with a line saying what the
 * current choice covers.
 *
 * One component behind both the All / NISA / 特定 switch and the Positions
 * screen's All / JP / US one, so the two read as the same kind of control and a
 * fix to either — the empty-value guard, the phone layout — reaches both.
 *
 * The hint is visible text, not a tooltip, and stays so on a phone. It used to
 * sit behind a Filters button there, which hid the one fact every figure on the
 * screen depends on behind a badge reading "1"; a tooltip would hide it again
 * from every touch screen, which never shows one.
 */
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import styles from './FilterSwitch.module.scss'
import { useIsMobile } from './useIsMobile'
import { cx } from '~/lib/cx'

export interface FilterOption<T extends string> {
  value: T
  label: string
}

export function FilterSwitch<T extends string>({
  label,
  options,
  hints,
  value,
  onChange,
}: {
  /** Names the group for screen readers — "Filter by account". */
  label: string
  options: readonly FilterOption<T>[]
  /** What each choice covers, said beside the switch. */
  hints: Record<T, string>
  value: T
  onChange: (next: T) => void
}) {
  // Full width with 40px-tall segments on a phone.
  const fill = useIsMobile()

  return (
    <div className={styles.control}>
      <ToggleGroup.Root
        type="single"
        className={cx(styles.group, fill && styles.fill)}
        style={fill ? { gridTemplateColumns: `repeat(${String(options.length)}, minmax(0, 1fr))` } : undefined}
        value={value}
        aria-label={label}
        onValueChange={(next) => {
          // Radix emits '' when the active item is pressed again. A filter with no
          // value selected would be a dead screen, so that is ignored rather than
          // treated as a change — and looking the value up, rather than casting
          // it, keeps anything else out too.
          const picked = options.find((option) => option.value === next)
          if (picked) onChange(picked.value)
        }}
      >
        {options.map((option) => (
          <ToggleGroup.Item
            key={option.value}
            value={option.value}
            className={styles.item}
            title={hints[option.value]}
          >
            {option.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
      <span className={styles.hint}>{hints[value]}</span>
    </div>
  )
}
