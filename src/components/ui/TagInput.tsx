/**
 * Tags as chips, each with its own remove button, and a field to type the next.
 *
 * Enter or a comma turns what is typed into a chip; Backspace in an empty field
 * takes the last one back into the field for editing. A tag already present is
 * not added twice. The typed text is the caller's state too, so a tag written
 * but never confirmed with Enter is still saved with the rest — see `withDraft`.
 */
import styles from './TagInput.module.scss'
import { cx } from '~/lib/cx'

/** The tags, plus whatever was still being typed. */
export function withDraft(tags: readonly string[], draft: string): string[] {
  const next = [...tags]
  for (const part of draft.split(',')) {
    const tag = part.trim()
    if (tag && !next.includes(tag)) next.push(tag)
  }
  return next
}

export function TagInput({
  tags,
  draft,
  onChange,
  onDraftChange,
  labelledBy,
  placeholder = 'Add a tag',
  className,
}: {
  tags: readonly string[]
  draft: string
  onChange: (tags: string[]) => void
  onDraftChange: (draft: string) => void
  /** The id of the visible label naming the field. */
  labelledBy: string
  placeholder?: string
  className?: string
}) {
  const commit = (text: string) => {
    const next = withDraft(tags, text)
    if (next.length !== tags.length) onChange(next)
    onDraftChange('')
  }

  return (
    <div className={cx(styles.field, className)}>
      <ul className={styles.chips} aria-labelledby={labelledBy}>
        {tags.map((tag) => (
          <li key={tag} className={styles.chip}>
            <span className={styles.chipText}>{tag}</span>
            <button
              type="button"
              className={styles.remove}
              aria-label={`Remove tag ${tag}`}
              onClick={() => {
                onChange(tags.filter((kept) => kept !== tag))
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <input
        type="text"
        className={styles.input}
        value={draft}
        placeholder={tags.length === 0 ? placeholder : ''}
        aria-labelledby={labelledBy}
        enterKeyHint="done"
        onChange={(event) => {
          const text = event.target.value
          // A comma ends a tag as Enter does — what the old comma-separated
          // field taught, and quicker on a phone keyboard.
          if (text.includes(',')) commit(text)
          else onDraftChange(text)
        }}
        onKeyDown={(event) => {
          // ⌘/Ctrl+Enter is the dialog's save; let it through untouched.
          if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
            event.preventDefault()
            commit(draft)
          } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
            event.preventDefault()
            onDraftChange(tags.at(-1) ?? '')
            onChange(tags.slice(0, -1))
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft)
        }}
      />
    </div>
  )
}
