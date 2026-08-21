/**
 * The Trades filter bar.
 *
 * Every control except the search box writes straight to its URL search param.
 * The box is debounced through `useDebouncedSymbol` — see the comment there for
 * why it cannot be bound directly.
 */
import styles from './TradeFilters.module.scss'
import type { SymbolField } from './useDebouncedSymbol'
import type { TradeSearch } from '~/lib/tradeSearch'

export function TradeFilters({
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
