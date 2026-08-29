/**
 * Downloads a generated file.
 *
 * The screens differ only in what they build and what they call it, so they
 * hand over a `file()` thunk rather than a string: the CSV is then assembled on
 * click instead of on every render of a table that re-sorts as you use it.
 */
import styles from './ExportButton.module.scss'
import { downloadTextFile } from '~/components/download'

export function ExportButton({
  file,
  disabled,
  children,
}: {
  /** Called on click. Returns the filename and body of the file to hand over. */
  file: () => { filename: string; body: string }
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={styles.button}
      disabled={disabled}
      onClick={() => {
        const { filename, body } = file()
        downloadTextFile(filename, body, 'text/csv;charset=utf-8')
      }}
    >
      {children}
    </button>
  )
}
