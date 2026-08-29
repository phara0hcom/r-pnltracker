/**
 * Truncated text that reveals itself in full on a long press.
 *
 * For instrument names, which are long, sit in narrow columns and — for funds —
 * are the only identifier a row has. A tap has to stay free for whatever the
 * cell already does, and touch has no hover, so the whole string is otherwise
 * unreachable on a phone. Pointer users get it from the `title`.
 *
 * Apply it to the line that actually carries the name: the second line for an
 * equity, the first for a fund, which has no ticker to put there. Never to a
 * bare ticker — `8411` does not overflow, and a popover on it is only in the way.
 *
 * `TradesTable` deliberately does not use this. It renders up to 250 rows a
 * page, and one `Popover.Root` each is real weight on a body memoised to
 * survive a column drag; it shares a single popover between its rows instead.
 */
import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'
import styles from './RevealableText.module.scss'
import { useLongPress } from './useLongPress'

export function RevealableText({
  text,
  className,
  as: Tag = 'span',
}: {
  text: string
  /** A CSS-module lookup, so `string | undefined` under `noUncheckedIndexedAccess`. */
  className: string | undefined
  /** The element to render, for cells whose line is a `<strong>` or a `<div>`. */
  as?: 'span' | 'div' | 'strong'
}) {
  const [open, setOpen] = useState(false)
  const { handlers } = useLongPress(() => {
    setOpen(true)
  })

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <Tag className={className} title={text} {...handlers}>
          {text}
        </Tag>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className={styles.popover}
          side="bottom"
          align="start"
          sideOffset={4}
          // Nothing here is interactive, and there is no trigger to hand focus
          // back to on close — moving it would strand the caret mid-table.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
          }}
        >
          {text}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
