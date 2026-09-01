import styles from './SegmentedTabs.module.scss'
import { cx } from '~/lib/cx'

/**
 * SP-only segmented control switching between a page's own sections.
 *
 * Local state, owned by the caller — no routing, no data fetching, just which
 * section is visible. `active`/`onChange` rather than internal state so the
 * page can key its section rendering off the same value.
 *
 * Deliberately a `group` of pressed buttons rather than a `tablist` of `tab`s.
 * The ARIA tab pattern is a contract: it promises arrow-key roving focus and
 * `aria-controls` pointing at a `tabpanel`, and the sections here are plain
 * sibling markup with no panel identity. A control that announces itself as
 * tabs and then does not respond to arrow keys is worse for a screen-reader
 * user than one that never claimed to. `aria-pressed` describes exactly what
 * these are: buttons, one of which is currently on. Matches the Tax basis
 * toggle, which is the same shape.
 */
export function SegmentedTabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: { id: T; label: string }[]
  active: T
  onChange: (id: T) => void
  /** Names the group for screen readers — "Section", "Sort by", and so on. */
  label: string
}) {
  return (
    <div
      className={styles.row}
      role="group"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${String(tabs.length)}, 1fr)` }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-pressed={tab.id === active}
          className={cx(styles.tab, tab.id === active && styles.active)}
          onClick={() => {
            onChange(tab.id)
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
