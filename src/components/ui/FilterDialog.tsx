/**
 * Filter controls behind a button, for phone-sized viewports.
 *
 * The controls themselves are passed in and rendered once — the screen decides
 * whether to show them inline or hand them here, so nothing is duplicated into
 * the document twice. See `useIsMobile` for why that matters.
 *
 * A bottom sheet rather than a centred modal: the controls land under the thumb
 * and the table stays visible above them.
 */
import * as Dialog from '@radix-ui/react-dialog'
import styles from './FilterDialog.module.scss'

export function FilterDialog({
  activeCount,
  children,
  title = 'Filters',
}: {
  /** Filters currently set. Drives the badge; 0 hides it. */
  activeCount: number
  children: React.ReactNode
  title?: string
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger className={styles.trigger}>
        <span aria-hidden="true">▽</span>
        {title}
        {activeCount > 0 ? (
          <span className={styles.count} aria-label={`${String(activeCount)} active`}>
            {activeCount}
          </span>
        ) : null}
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <div className={styles.head}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
            <Dialog.Close className={styles.close} aria-label="Close filters">
              <span aria-hidden="true">✕</span>
            </Dialog.Close>
          </div>

          {children}

          {/* Every control writes straight to the URL, so there is nothing to
              submit — this only dismisses the sheet. */}
          <Dialog.Close className={styles.done}>Done</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
