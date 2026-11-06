/**
 * A setup's name, description and criteria, for the Setups page and step 2 of
 * Open position.
 *
 * Criteria are a row each rather than lines of one text box: a row keeps its id
 * through a rename, which is what lets ticks already recorded against it survive.
 * A line of text has nothing to carry that on. A blank row is dropped by the server.
 */
import styles from './Dialog.module.scss'
import { FormField } from '~/components/trades/FormField'
import { cx } from '~/lib/cx'
import type { Criterion } from '~/lib/playbook/types'

interface CriterionDraft {
  key: string
  /** Absent on a new one, which the server gives an id. */
  id?: string
  text: string
}

export interface SetupDraft {
  name: string
  description: string
  criteria: CriterionDraft[]
}

let nextKey = 0
const blankCriterion = (): CriterionDraft => ({ key: `new-${String(nextKey++)}`, text: '' })

export function toSetupDraft(
  setup: { name: string; description: string; criteria: Criterion[] } | null,
): SetupDraft {
  if (!setup) return { name: '', description: '', criteria: [blankCriterion()] }
  return {
    name: setup.name,
    description: setup.description,
    criteria: setup.criteria.map(({ id, text }) => ({ key: id, id, text })),
  }
}

/**
 * The list's order is the order the checklist shows on every position. Ticks are
 * stored by id, so moving a criterion keeps what was recorded against it.
 */
function moveCriterion(criteria: CriterionDraft[], from: number, to: number): CriterionDraft[] {
  const moved = criteria[from]
  if (!moved || to < 0 || to >= criteria.length) return criteria
  const next = criteria.filter((_, index) => index !== from)
  next.splice(to, 0, moved)
  return next
}

export function toSetupInput(draft: SetupDraft) {
  return {
    name: draft.name,
    description: draft.description,
    criteria: draft.criteria.map(({ id, text }) => ({ id, text })),
  }
}

export function SetupFields({ draft, onChange }: { draft: SetupDraft; onChange: (draft: SetupDraft) => void }) {
  const setCriteria = (criteria: CriterionDraft[]) => {
    onChange({ ...draft, criteria })
  }
  return (
    <>
      <FormField label="Name">
        <input
          className={styles.input}
          value={draft.name}
          maxLength={80}
          onChange={(event) => {
            onChange({ ...draft, name: event.target.value })
          }}
        />
      </FormField>
      <FormField label="Description">
        <textarea
          className={styles.textarea}
          value={draft.description}
          maxLength={1000}
          onChange={(event) => {
            onChange({ ...draft, description: event.target.value })
          }}
        />
      </FormField>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Entry criteria — ticked on each position</legend>
        {draft.criteria.map((criterion, index) => (
          <div key={criterion.key} className={styles.criterionRow}>
            <input
              className={styles.input}
              aria-label={`Criterion ${String(index + 1)}`}
              value={criterion.text}
              maxLength={200}
              onChange={(event) => {
                setCriteria(
                  draft.criteria.map((item) =>
                    item.key === criterion.key ? { ...item, text: event.target.value } : item,
                  ),
                )
              }}
            />
            <button
              type="button"
              className={cx(styles.secondary, styles.small)}
              disabled={index === 0}
              onClick={() => {
                setCriteria(moveCriterion(draft.criteria, index, index - 1))
              }}
            >
              <span aria-hidden="true">↑</span>
              <span className="visually-hidden">Move criterion {index + 1} up</span>
            </button>
            <button
              type="button"
              className={cx(styles.secondary, styles.small)}
              disabled={index === draft.criteria.length - 1}
              onClick={() => {
                setCriteria(moveCriterion(draft.criteria, index, index + 1))
              }}
            >
              <span aria-hidden="true">↓</span>
              <span className="visually-hidden">Move criterion {index + 1} down</span>
            </button>
            <button
              type="button"
              className={cx(styles.secondary, styles.small)}
              onClick={() => {
                setCriteria(draft.criteria.filter((item) => item.key !== criterion.key))
              }}
            >
              Remove<span className="visually-hidden"> criterion {index + 1}</span>
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className={cx(styles.secondary, styles.small)}
            onClick={() => {
              setCriteria([...draft.criteria, blankCriterion()])
            }}
          >
            Add a criterion
          </button>
        </div>
      </fieldset>
    </>
  )
}
