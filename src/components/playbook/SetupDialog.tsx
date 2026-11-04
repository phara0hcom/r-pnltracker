/**
 * Create, edit or archive a setup. Mounted only while open, so it starts from the
 * setup as it now reads.
 *
 * Archiving keeps the setup's positions and frees its name. They stay on the
 * Playbook under that name; the setup itself leaves the Setups page.
 */
import { useState } from 'react'
import styles from './Dialog.module.scss'
import { Frame } from './PositionDialogs'
import { SetupFields, toSetupDraft, toSetupInput } from './SetupFields'
import { usePlaybookAction } from './usePlaybookAction'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { cx } from '~/lib/cx'
import type { Criterion } from '~/lib/playbook/types'
import { archiveSetup, createSetupInline, updateSetup, type ActionResult } from '~/server/playbook'

export function SetupDialog({
  setup,
  onClose,
  onArchived,
}: {
  /** Null to create one. */
  setup: { id: string; name: string; description: string; criteria: Criterion[] } | null
  onClose: () => void
  /** Where to go once it is gone; closes by default. */
  onArchived?: () => void
}) {
  const [draft, setDraft] = useState(() => toSetupDraft(setup))
  const save = usePlaybookAction((): Promise<ActionResult> => {
    const input = toSetupInput(draft)
    return setup ? updateSetup({ data: { id: setup.id, ...input } }) : createSetupInline({ data: input })
  }, onClose)
  const archive = usePlaybookAction(
    (id: string): Promise<ActionResult> => archiveSetup({ data: { id } }),
    () => {
      onClose()
      onArchived?.()
    },
  )
  const problem = save.problem ?? archive.problem
  return (
    <Frame
      open
      onClose={onClose}
      title={setup ? `Edit setup — ${setup.name}` : 'New setup'}
      description="A type of play. Whether a trade was real or paper belongs to the position, not to its setup."
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          save.run(undefined)
        }}
      >
        <SetupFields draft={draft} onChange={setDraft} />
        {problem ? (
          <p className={styles.formError} role="alert">
            {problem}
          </p>
        ) : null}
        <div className={styles.footer}>
          {setup ? (
            <ConfirmButton
              variant="text"
              className={styles.footerGap}
              disabled={archive.pending}
              title="Its positions stay on the Playbook, and its name becomes free"
              onConfirm={() => {
                archive.run(setup.id)
              }}
            >
              Archive setup
            </ConfirmButton>
          ) : null}
          <button type="button" className={cx(styles.secondary, !setup && styles.footerGap)} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.primary} disabled={save.pending || draft.name.trim() === ''}>
            {save.pending ? 'Saving…' : setup ? 'Save' : 'Create setup'}
          </button>
        </div>
      </form>
    </Frame>
  )
}
