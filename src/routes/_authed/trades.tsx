/**
 * Trades table.
 *
 * Filter and sort state lives in typed URL search params, so a view is
 * shareable and survives a refresh — the main reason this app is on TanStack
 * Router. `tradeSearchSchema` rejects malformed params into defaults rather
 * than throwing, so a hand-edited URL degrades instead of erroring.
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
import { useCallback, useMemo, useState } from 'react'
import styles from './trades.module.scss'
import { PageHeader, Pagination } from '~/components/screen'
import { NewTradeDialog } from '~/components/trades/NewTradeDialog'
import { TradeFilters } from '~/components/trades/TradeFilters'
import { TradesTable } from '~/components/trades/TradesTable'
import { useDebouncedSymbol } from '~/components/trades/useDebouncedSymbol'
import { ExportButton } from '~/components/ui/ExportButton'
import { useIsMobile } from '~/components/ui/useIsMobile'
import { tradesCsv, tradesCsvFilename } from '~/lib/export/tradesCsv'
import { nextSort, sortRows, type SortColumn } from '~/lib/sortRows'
import { PER_PAGE_OPTIONS, tradeSearchSchema, type TradeSearch, type TradeSortKey } from '~/lib/tradeSearch'
import { listCashLedger, listTradeRows, type TradeRow } from '~/server/trades'

/**
 * How each sortable column reads its own value, keyed by its sort key.
 *
 * Return % is a number; the rest of the numeric columns are decimal strings.
 * Either way `numeric` is what keeps them off `localeCompare`, where "9" would
 * sort above "10".
 */
const COLUMNS: Record<TradeSortKey, SortColumn<TradeRow>> = {
  tradeDate: { value: (row) => row.tradeDate },
  settleDate: { value: (row) => row.settleDate },
  symbol: { value: (row) => row.symbol },
  quantity: { numeric: true, value: (row) => row.quantity },
  displayPrice: { numeric: true, value: (row) => row.displayPrice },
  netAmountJpy: { numeric: true, value: (row) => row.netAmountJpy },
  // Null on an open position, which sorts last either way — an unclosed trade
  // is unmeasured, not a loss.
  realizedJpy: { numeric: true, value: (row) => row.realizedJpy },
  returnPct: { numeric: true, value: (row) => row.returnPct },
}

export const Route = createFileRoute('/_authed/trades')({
  validateSearch: tradeSearchSchema,
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

  // Deposits, withdrawals, 譲渡益税 and dividends — everything that moves cash
  // without being a trade. Only the export uses it, but it is fetched with the
  // screen rather than on click: `ExportButton` builds its file synchronously,
  // so the data has to be here already.
  const { data: ledger } = useQuery({
    queryKey: ['cash-ledger'],
    queryFn: () => listCashLedger(),
  })

  // Stable identities: `TradesTable` memoises its body against these, so a
  // fresh closure per render would defeat that on every column resize.
  const invalidate = useCallback(() => {
    // Realized P&L, NISA quota and tax all derive from trades, so an edit
    // invalidates far more than this table.
    void queryClient.invalidateQueries()
  }, [queryClient])

  const setSearch = useCallback(
    (patch: Partial<TradeSearch>) => {
      // Any change to filters or sorting invalidates the current page number.
      const resetsPage = !('page' in patch)
      void navigate({
        search: (prev) => ({ ...prev, ...patch, ...(resetsPage ? { page: 1 } : {}) }),
        replace: true,
        // The router scrolls to the top on every navigation by default, which
        // would throw the reader back to the header on every page turn or
        // filter tweak — the same fix Stats' own setSearch needed.
        resetScroll: false,
      })
    },
    [navigate],
  )

  const commitSymbol = useCallback(
    (next: string) => {
      setSearch({ symbol: next || undefined })
    },
    [setSearch],
  )
  const symbol = useDebouncedSymbol(search.symbol ?? '', commitSymbol)

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

    return sortRows(list, COLUMNS, search.sortBy, search.sortDir)
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
    let realized = 0
    let closes = 0
    let wins = 0
    for (const row of filtered) {
      if (row.realizedJpy == null) continue
      const value = Number(row.realizedJpy)
      realized += value
      closes += 1
      if (value > 0) wins += 1
    }
    return {
      count: filtered.length,
      realized,
      winRate: closes ? wins / closes : null,
    }
  }, [filtered])

  /*
   * Columns the active filter has pinned to one value.
   *
   * Filtering to sells makes Side read SELL on every row, and the filter bar
   * above already says so — the column is then a word repeated down the page.
   * `assetClass` and `outcome` pin nothing: this table has no class column, and
   * a win/loss filter narrows a range rather than fixing a value.
   */
  const isMobile = useIsMobile()

  /*
   * How many filters are set. The live search text, not `search.symbol`, so the
   * badge appears as you type rather than a quarter of a second later — the
   * same reason `TradeFilters` reads it for its Clear button.
   */
  const activeFilters = useMemo(
    () =>
      [
        search.from,
        search.to,
        search.account,
        search.assetClass,
        search.side,
        search.outcome,
        symbol.text || undefined,
      ].filter(Boolean).length,
    [search, symbol.text],
  )

  const filters = (
    <TradeFilters search={search} symbol={symbol} onChange={setSearch} bare={isMobile} />
  )

  const redundant = useMemo(() => {
    const keys: string[] = []
    if (search.side) keys.push('side')
    if (search.account) keys.push('account')
    return keys
  }, [search.side, search.account])

  const onSort = useCallback(
    (col: TradeSortKey) => {
      setSearch(nextSort(col, search.sortBy, search.sortDir))
    },
    [setSearch, search.sortBy, search.sortDir],
  )

  // Exports `rows`, deliberately ignoring the screen's filters and sort.
  //
  // A TradingView portfolio is rebuilt by replaying these fills in order, so it
  // needs a coherent history rather than a slice of one. Several of this
  // screen's filters cut a history mid-stream — `outcome` and a SELL-only
  // `side` keep closes while dropping every open (realized P&L is null on an
  // open), and a `from` date can land between a buy and its sell. Each of those
  // exports an unpaired Sell, which TradingView reads as opening a short that
  // never happened.
  //
  // The Positions export does follow its screen, and correctly: a snapshot
  // stays true when you take a subset of it. A replay does not.
  const exportFile = useCallback(
    () => ({ filename: tradesCsvFilename(), body: tradesCsv(rows, ledger ?? {}) }),
    [rows, ledger],
  )

  const onSaved = useCallback(() => {
    setEditingId(null)
    invalidate()
  }, [invalidate])

  return (
    <>
      <PageHeader
        title="Trades"
        meta={
          <>
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
          </>
        }
      >
        {/* "all" is load-bearing: the file ignores the filters above it.
            Held disabled until the ledger lands: exporting without it would
            silently omit every deposit, withdrawal and dividend. */}
        <ExportButton file={exportFile} disabled={rows.length === 0 || ledger == null}>
          Export all for TradingView
        </ExportButton>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => {
            setAdding(true)
          }}
        >
          + Add trade
        </button>
      </PageHeader>

      <NewTradeDialog open={adding} onOpenChange={setAdding} onCreated={invalidate} />

      {isMobile ? null : filters}

      {isPending ? (
        <p className={styles.empty}>Loading trades…</p>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>No trades match these filters.</p>
      ) : (
        <TradesTable
          rows={pageRows}
          redundant={redundant}
          filters={isMobile ? filters : null}
          activeFilters={activeFilters}
          sortBy={search.sortBy}
          sortDir={search.sortDir}
          onSort={onSort}
          editingId={editingId}
          onEdit={setEditingId}
          onSaved={onSaved}
          onDeleted={invalidate}
        />
      )}

      {filtered.length > 0 ? (
        <Pagination
          label="Trades pagination"
          page={page}
          pageCount={pageCount}
          perPage={perPage}
          perPageOptions={PER_PAGE_OPTIONS}
          total={filtered.length}
          onPage={(point) => {
            setSearch({ page: point })
          }}
          onPerPage={(size) => {
            setSearch({ perPage: size })
          }}
        />
      ) : null}
    </>
  )
}
