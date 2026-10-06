/**
 * The Positions screen's last market choice, for the links that lead back to it.
 *
 * The choice itself lives in the URL (`?market=`), like every filter here. But
 * only Positions declares it, so it is gone from the URL the moment you leave:
 * the sidebar and the dashboard rebuild their Positions link from the account
 * switch alone. They read this to put the market back on, so returning to
 * Positions shows the market you left it on. The URL stays the source of truth
 * — this only ever fills in a link, and Positions records whatever its URL says.
 *
 * `sessionStorage`, so it lasts the tab — through a reload of another screen —
 * and no longer: a new session starts from both markets, as a shared link does.
 * A preference about which market to look at, never a figure, so it is not part
 * of the saved copies wiped at sign-out.
 */
import { useSyncExternalStore } from 'react'
import type { MarketFilter } from '~/lib/domain/types'
import { toMarketFilter } from '~/lib/marketScope'
import { breadcrumb } from '~/lib/observability/report'

const STORAGE_KEY = 'positions.market'

const listeners = new Set<() => void>()

function read(): MarketFilter {
  try {
    return toMarketFilter(window.sessionStorage.getItem(STORAGE_KEY))
  } catch {
    // Blocked storage (a private window, a locked-down browser) means the
    // links fall back to both markets — the same as never having chosen.
    breadcrumb('sessionStorage read failed', { key: STORAGE_KEY })
    return 'ALL'
  }
}

export function rememberMarket(market: MarketFilter): void {
  if (read() === market) return
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
 * The remembered market, `ALL` on the server — which has no storage — and so on
 * the first client render too, which then adopts the stored value. A link that
 * gains `?market=` a moment after load is harmless; a hydration mismatch is not.
 */
export function useRememberedMarket(): MarketFilter {
  return useSyncExternalStore(subscribe, read, () => 'ALL')
}

/** The `market` search param for a link to Positions: absent for both markets. */
export const marketSearch = (market: MarketFilter): MarketFilter | undefined =>
  market === 'ALL' ? undefined : market
