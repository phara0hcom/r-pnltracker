/**
 * The market last picked on the Positions switch, for the sidebar's link back.
 *
 * The choice itself lives in the URL (`?market=`), like every filter here. But
 * only Positions declares it, so it is gone from the URL the moment you leave,
 * and the sidebar rebuilds its links from the account switch alone. It reads
 * this to put the market back on the Positions link, so returning there shows
 * the market you picked. The URL stays the source of truth: this only fills in
 * that one link, and only a tap on the switch changes it — not a URL that
 * arrives without `?market=`, which would otherwise wipe it before you chose.
 *
 * Not on the dashboard's "View positions": that link explains figures covering
 * both markets, and must open on both. The alternative to this — declaring
 * `market` on every route, as `scope` is — would put a parameter that does
 * nothing on ten screens' URLs.
 *
 * `sessionStorage`, so it lasts the tab, through a reload of another screen;
 * a tab duplicated from it starts with a copy, as browsers do. A preference
 * about which market to look at, never a figure.
 */
import { useSyncExternalStore } from 'react'
import type { MarketFilter } from '~/lib/domain/types'
import { marketParam, toMarketFilter } from '~/lib/marketScope'
import { breadcrumb } from '~/lib/observability/report'

const STORAGE_KEY = 'pnl.positions.market'

const listeners = new Set<() => void>()

/**
 * Read from storage once, then kept here: `read` is a `useSyncExternalStore`
 * snapshot, which React calls on every render of every subscriber, so it must
 * be a cheap, side-effect-free read — a storage access that throws in a locked-
 * down browser would otherwise leave a breadcrumb per render.
 */
let cached: MarketFilter | null = null

function read(): MarketFilter {
  if (cached != null) return cached
  try {
    cached = toMarketFilter(window.sessionStorage.getItem(STORAGE_KEY))
  } catch {
    // Blocked storage (a private window, a locked-down browser) means the link
    // falls back to both markets — the same as never having chosen.
    breadcrumb('sessionStorage read failed', { key: STORAGE_KEY })
    cached = 'ALL'
  }
  return cached
}

/** Called by the Positions switch, and only by it — see above. */
export function rememberMarket(market: MarketFilter): void {
  if (read() === market) return
  cached = market
  try {
    if (market === 'ALL') window.sessionStorage.removeItem(STORAGE_KEY)
    else window.sessionStorage.setItem(STORAGE_KEY, market)
  } catch {
    breadcrumb('sessionStorage write failed', { key: STORAGE_KEY })
  }
  for (const listener of listeners) listener()
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/**
 * The remembered market as the `market` search param, absent for both. `ALL`
 * on the server — which has no storage — and so on the first client render
 * too, which then adopts the stored value: a link that gains `?market=` a
 * moment after load is harmless; a hydration mismatch is not.
 */
export function useRememberedMarketParam(): ReturnType<typeof marketParam> {
  return marketParam(useSyncExternalStore(subscribe, read, () => 'ALL'))
}
