/**
 * Page controls for a long table.
 *
 * Shows the row range rather than only page numbers — "51–100 of 315" answers
 * "where am I" better than "page 2 of 7".
 *
 * The row-count options come from the caller rather than being fixed here: what
 * counts as a sensible page differs by screen, and the type parameter carries
 * whichever literal union that screen's search schema accepts, so a size the
 * URL could not hold fails to compile at the call site.
 */
import styles from './Pagination.module.scss'

export function Pagination<Size extends number>({
  label,
  page,
  pageCount,
  perPage,
  perPageOptions,
  total,
  onPage,
  onPerPage,
}: {
  /** Names the nav for screen readers — one page may hold more than one. */
  label: string
  page: number
  pageCount: number
  perPage: number
  perPageOptions: readonly Size[]
  total: number
  onPage: (page: number) => void
  onPerPage: (perPage: Size) => void
}) {
  const first = (page - 1) * perPage + 1
  const last = Math.min(page * perPage, total)

  return (
    <nav className={styles.pagination} aria-label={label}>
      <span className={styles.pageInfo}>
        {first}–{last} of {total}
      </span>

      <label className={styles.perPage}>
        <span className={styles.perPageLabel}>Rows</span>
        <select
          className={styles.perPageSelect}
          value={perPage}
          onChange={(event) => {
            // Matched back against the options rather than cast from the
            // element's string value: the cast would assert a literal type the
            // DOM cannot actually guarantee.
            const size = perPageOptions.find((option) => String(option) === event.target.value)
            if (size !== undefined) onPerPage(size)
          }}
        >
          {perPageOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.pageButtons}>
        <button
          type="button"
          className={styles.pageButton}
          onClick={() => {
            onPage(1)
          }}
          disabled={page === 1}
          aria-label="First page"
        >
          «
        </button>
        <button
          type="button"
          className={styles.pageButton}
          onClick={() => {
            onPage(page - 1)
          }}
          disabled={page === 1}
          aria-label="Previous page"
        >
          ‹
        </button>
        <span className={styles.pageCurrent}>
          {page} / {pageCount}
        </span>
        <button
          type="button"
          className={styles.pageButton}
          onClick={() => {
            onPage(page + 1)
          }}
          disabled={page === pageCount}
          aria-label="Next page"
        >
          ›
        </button>
        <button
          type="button"
          className={styles.pageButton}
          onClick={() => {
            onPage(pageCount)
          }}
          disabled={page === pageCount}
          aria-label="Last page"
        >
          »
        </button>
      </div>
    </nav>
  )
}
