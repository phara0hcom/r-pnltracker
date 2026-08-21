/**
 * Page controls for the Trades table.
 *
 * Shows the row range rather than only page numbers — "51–100 of 315" answers
 * "where am I" better than "page 2 of 7".
 */
import styles from './Pagination.module.scss'
import { PER_PAGE_OPTIONS, type PerPage } from '~/lib/tradeSearch'

export function Pagination({
  page,
  pageCount,
  perPage,
  total,
  onPage,
  onPerPage,
}: {
  page: number
  pageCount: number
  perPage: number
  total: number
  onPage: (page: number) => void
  onPerPage: (perPage: PerPage) => void
}) {
  const first = (page - 1) * perPage + 1
  const last = Math.min(page * perPage, total)

  return (
    <nav className={styles.pagination} aria-label="Trades pagination">
      <span className={styles.pageInfo}>
        {first}–{last} of {total}
      </span>

      <label className={styles.perPage}>
        <span className={styles.perPageLabel}>Rows</span>
        <select
          className={styles.perPageSelect}
          value={perPage}
          onChange={(event) => {
            onPerPage(Number(event.target.value) as PerPage)
          }}
        >
          {PER_PAGE_OPTIONS.map((size) => (
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
