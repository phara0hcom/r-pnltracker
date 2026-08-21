/**
 * Trades table.
 *
 * Filter and sort state lives in typed URL search params, so a view is
 * shareable and survives a refresh — the main reason this app is on TanStack
 * Router. `validateSearch` rejects malformed params into defaults rather than
 * throwing, so a hand-edited URL degrades instead of erroring.
 *
 * Editing is explicit: an Edit button puts one row into edit mode, its cells
 * become inputs, and Save runs the same zod validation and `updateTrade` path
 * that hand-entered trades use. One validated code path, not two.
 *
 * The text search is the one filter that cannot be driven straight off the URL —
 * see `useDebouncedSymbol`.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import styles from './trades.module.scss'
import { NewTradeDialog } from '~/components/trades/NewTradeDialog'
import { TradesTable } from '~/components/trades/TradesTable'
import { listTradeRows } from '~/server/trades'

const ACCOUNTS = ['SPECIFIC', 'NISA_OLD', 'NISA_GROWTH', 'NISA_TSUMITATE'] as const
const CLASSES = ['JP_EQUITY', 'US_EQUITY', 'FUND'] as const
const SIDES = ['BUY', 'SELL', 'REINVEST', 'REDEEM'] as const
const SORTABLE = [
  'tradeDate',
  'settleDate',
  'symbol',
  'quantity',
  'displayPrice',
  'netAmountJpy',
  'realizedJpy',
  'returnPct',
] as const

/**
 * `.catch()` on every field is deliberate: a stale bookmark or hand-edited URL
 * should fall back to the default view, never blow up the route.
 */
const searchSchema = z.object({
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  account: z.enum(ACCOUNTS).optional().catch(undefined),
  assetClass: z.enum(CLASSES).optional().catch(undefined),
  side: z.enum(SIDES).optional().catch(undefined),
  symbol: z.string().optional().catch(undefined),
  outcome: z.enum(['win', 'loss']).optional().catch(undefined),
  sortBy: z.enum(SORTABLE).catch('tradeDate'),
  sortDir: z.enum(['asc', 'desc']).catch('desc'),
  // Paging lives in the URL like the filters, so a link points at the same page.
  page: z.number().int().min(1).catch(1).optional(),
  perPage: z.union([z.literal(25), z.literal(50), z.literal(100), z.literal(250)])
    .catch(50)
    .optional(),
  // The sidebar's All/NISA/特定 switch. This screen keeps its own richer
  // four-way `account` filter and does not apply `scope`, but must carry it:
  // a zod object strips unknown keys, so passing through Trades would otherwise
  // silently discard the switch and it could not come back.
  scope: z.enum(['ALL', 'NISA', 'SPECIFIC']).catch('ALL').optional(),
})

export type TradeSearch = z.infer<typeof searchSchema>
type PerPage = NonNullable<TradeSearch['perPage']>

/** Long enough to type a word through, short enough that the URL feels current. */
const SEARCH_DEBOUNCE_MS = 250

/**
 * The text search, held locally and written through to the URL after a pause.
 *
 * Every other filter can be bound straight to its search param, but this one
 * cannot: `navigate` commits inside a React transition, so between a keystroke
 * and the commit the input re-renders with the value from *before* that
 * keystroke and the character is lost. Typing faster than the round trip meant
 * losing most of a word — the field read as disabled.
 *
 * So the box owns its text and the URL follows. `pushed` is what this hook last
 * sent there and `seenUrl` is the last value it reacted to; together they tell a
 * URL change this hook caused (ignore it — the box is already ahead) from one it
 * did not (Clear filters, the back button, a shared link — adopt it).
 */
function useDebouncedSymbol(urlValue: string, commit: (next: string) => void) {
  const [text, setText] = useState(urlValue)
  const pushed = useRef(urlValue)
  const seenUrl = useRef(urlValue)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Held in a ref so the debounce below depends on the text alone. `commit` is a
  // fresh closure every render, and as a dependency it would restart the timer
  // on each one — a pause that never elapses.
  const latestCommit = useRef(commit)
  useEffect(() => {
    latestCommit.current = commit
  })

  useEffect(() => {
    if (urlValue === seenUrl.current) return
    seenUrl.current = urlValue
    if (urlValue === pushed.current) return
    // `pushed` moves too: the box now matches the URL, so there is nothing left
    // to write. Without this the debounce below sees text it has not sent and
    // commits the value straight back — a navigation that does nothing except
    // reset the page number.
    pushed.current = urlValue
    setText(urlValue)
  }, [urlValue])

  useEffect(() => {
    if (text === pushed.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      pushed.current = text
      latestCommit.current(text)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [text])

  return {
    text,
    onType: setText,
    /** Enter: apply now rather than waiting out the pause. */
    flush: () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      if (text === pushed.current) return
      pushed.current = text
      latestCommit.current(text)
    },
    /**
     * Empty the box and drop any pending write, for callers that clear the
     * param themselves — otherwise the in-flight keystrokes land afterwards and
     * put the filter straight back.
     */
    clear: () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      pushed.current = ''
      setText('')
    },
  }
}

type SymbolField = ReturnType<typeof useDebouncedSymbol>

export const Route = createFileRoute('/_authed/trades')({
  validateSearch: searchSchema,
  component: TradesScreen,
})

function TradesScreen() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const { data: rows = [], isPending } = useQuery({
    queryKey: ['trades'],
    queryFn: () => listTradeRows(),
  })

  const invalidate = () => {
    // Realized P&L, NISA quota and tax all derive from trades, so an edit
    // invalidates far more than this table.
    void queryClient.invalidateQueries()
  }

  const setSearch = (patch: Partial<TradeSearch>) => {
    // Any change to filters or sorting invalidates the current page number.
    const resetsPage = !('page' in patch)
    void navigate({
      search: (prev) => ({ ...prev, ...patch, ...(resetsPage ? { page: 1 } : {}) }),
      replace: true,
    })
  }

  const symbol = useDebouncedSymbol(search.symbol ?? '', (next) => {
    setSearch({ symbol: next || undefined })
  })

  // Filtered off the live text, not the debounced param: the rows are already in
  // memory, so there is nothing to wait for and results track the typing.
  const filtered = useMemo(() => {
    const searchText = symbol.text.trim().toLowerCase()
    const list = rows.filter((row) => {
      if (search.from && row.tradeDate < search.from) return false
      if (search.to && row.tradeDate > search.to) return false
      if (search.account && row.accountType !== search.account) return false
      if (search.assetClass && row.assetClass !== search.assetClass) return false
      if (search.side && row.side !== search.side) return false
      if (
        searchText &&
        !row.symbol.toLowerCase().includes(searchText) &&
        !row.name.toLowerCase().includes(searchText)
      ) {
        return false
      }
      if (search.outcome) {
        if (row.realizedJpy == null) return false
        const realized = Number(row.realizedJpy)
        if (search.outcome === 'win' && realized <= 0) return false
        if (search.outcome === 'loss' && realized >= 0) return false
      }
      return true
    })

    const direction = search.sortDir === 'asc' ? 1 : -1
    const key = search.sortBy
    // Return % is a number; the rest of the numeric columns are decimal strings.
    // Either way they must compare numerically, never lexically — otherwise
    // "9" sorts above "10".
    const numeric =
      key === 'quantity' ||
      key === 'displayPrice' ||
      key === 'netAmountJpy' ||
      key === 'realizedJpy' ||
      key === 'returnPct'

    return [...list].sort((left, right) => {
      const leftValue = left[key]
      const rightValue = right[key]
      // Rows without a realized figure sort last regardless of direction —
      // an open position is not "worse" than a loss.
      if (leftValue == null) return 1
      if (rightValue == null) return -1
      if (numeric) return (Number(leftValue) - Number(rightValue)) * direction
      // Remaining columns are strings, but the union still includes number, so
      // coerce rather than assume.
      return String(leftValue).localeCompare(String(rightValue)) * direction
    })
  }, [rows, search, symbol.text])

  const perPage = search.perPage ?? 50
  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage))
  // Clamp rather than 404: narrowing a filter while on page 9 should land on the
  // last real page, not an empty one.
  const page = Math.min(Math.max(search.page ?? 1, 1), pageCount)
  const pageRows = useMemo(
    () => filtered.slice((page - 1) * perPage, page * perPage),
    [filtered, page, perPage],
  )

  const totals = useMemo(() => {
    const realized = filtered.reduce(
      (running, row) => running + (row.realizedJpy ? Number(row.realizedJpy) : 0),
      0,
    )
    const closes = filtered.filter((row) => row.realizedJpy != null)
    const wins = closes.filter((row) => Number(row.realizedJpy) > 0).length
    return {
      count: filtered.length,
      realized,
      winRate: closes.length ? wins / closes.length : null,
    }
  }, [filtered])

  return (
    <>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Trades</h1>
          <p className={styles.meta}>
            {totals.count} of {rows.length} shown
            {totals.realized !== 0 ? (
              <>
                {' · realized '}
                <span className={totals.realized >= 0 ? styles.profit : styles.loss}>
                  ¥{totals.realized.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </span>
              </>
            ) : null}
            {totals.winRate != null ? ` · ${(totals.winRate * 100).toFixed(0)}% win` : null}
          </p>
        </div>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => {
            setAdding(true)
          }}
        >
          + Add trade
        </button>
      </header>

      <NewTradeDialog open={adding} onOpenChange={setAdding} onCreated={invalidate} />

      <Filters search={search} symbol={symbol} onChange={setSearch} />

      {isPending ? (
        <p className={styles.empty}>Loading trades…</p>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>No trades match these filters.</p>
      ) : (
        <TradesTable
          rows={pageRows}
          sortBy={search.sortBy}
          sortDir={search.sortDir}
          onSort={(col) => {
            setSearch({
              sortBy: col,
              sortDir: search.sortBy === col && search.sortDir === 'desc' ? 'asc' : 'desc',
            })
          }}
          editingId={editingId}
          onEdit={setEditingId}
          onSaved={() => {
            setEditingId(null)
            invalidate()
          }}
          onDeleted={invalidate}
        />
      )}

      {filtered.length > 0 ? (
        <Pagination
          page={page}
          pageCount={pageCount}
          perPage={perPage}
          total={filtered.length}
          onPage={(point) => {
            setSearch({ page: point })
          }}
          onPerPage={(note) => {
            setSearch({ perPage: note })
          }}
        />
      ) : null}
    </>
  )
}

function Filters({
  search,
  symbol,
  onChange,
}: {
  search: TradeSearch
  symbol: SymbolField
  onChange: (patch: Partial<TradeSearch>) => void
}) {
  // The live text, not `search.symbol`: Clear filters has to appear as soon as
  // there is something to clear, not a quarter of a second later.
  const active =
    search.from ??
    search.to ??
    search.account ??
    search.assetClass ??
    search.side ??
    (symbol.text || undefined) ??
    search.outcome

  return (
    <div className={styles.filters}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Search</span>
        <input
          type="search"
          className={styles.input}
          placeholder="Symbol or name"
          value={symbol.text}
          onChange={(event) => {
            symbol.onType(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Nothing to submit — this only skips the remaining pause.
              event.preventDefault()
              symbol.flush()
            }
            // Guarded, so Escape on an empty box is not a navigation that
            // quietly sends you back to page 1.
            if (event.key === 'Escape' && (symbol.text || search.symbol != null)) {
              symbol.clear()
              onChange({ symbol: undefined })
            }
          }}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>From</span>
        <input
          type="date"
          className={styles.input}
          value={search.from ?? ''}
          onChange={(event) => {
            onChange({ from: event.target.value || undefined })
          }}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>To</span>
        <input
          type="date"
          className={styles.input}
          value={search.to ?? ''}
          onChange={(event) => {
            onChange({ to: event.target.value || undefined })
          }}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Account</span>
        <select
          className={styles.input}
          value={search.account ?? ''}
          onChange={(event) => {
            onChange({ account: (event.target.value || undefined) as TradeSearch['account'] })
          }}
        >
          <option value="">All</option>
          <option value="SPECIFIC">特定 (taxable)</option>
          <option value="NISA_GROWTH">NISA 成長</option>
          <option value="NISA_TSUMITATE">NISA つみたて</option>
          <option value="NISA_OLD">旧NISA</option>
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Asset</span>
        <select
          className={styles.input}
          value={search.assetClass ?? ''}
          onChange={(event) => {
            onChange({ assetClass: (event.target.value || undefined) as TradeSearch['assetClass'] })
          }}
        >
          <option value="">All</option>
          <option value="JP_EQUITY">JP equity</option>
          <option value="US_EQUITY">US equity</option>
          <option value="FUND">Fund</option>
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Side</span>
        <select
          className={styles.input}
          value={search.side ?? ''}
          onChange={(event) => {
            onChange({ side: (event.target.value || undefined) as TradeSearch['side'] })
          }}
        >
          <option value="">All</option>
          <option value="BUY">Buy</option>
          <option value="SELL">Sell</option>
          <option value="REINVEST">Reinvest</option>
          <option value="REDEEM">Redeem</option>
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Outcome</span>
        <select
          className={styles.input}
          value={search.outcome ?? ''}
          onChange={(event) => {
            onChange({ outcome: (event.target.value || undefined) as TradeSearch['outcome'] })
          }}
        >
          <option value="">All</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
        </select>
      </label>

      {active ? (
        <button
          type="button"
          className={styles.clear}
          onClick={() => {
            symbol.clear()
            onChange({
              from: undefined,
              to: undefined,
              account: undefined,
              assetClass: undefined,
              side: undefined,
              symbol: undefined,
              outcome: undefined,
            })
          }}
        >
          Clear filters
        </button>
      ) : null}
    </div>
  )
}

/**
 * Page controls.
 *
 * Shows the row range rather than only page numbers — "51–100 of 315" answers
 * "where am I" better than "page 2 of 7".
 */
function Pagination({
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
          {[25, 50, 100, 250].map((note) => (
            <option key={note} value={note}>
              {note}
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
