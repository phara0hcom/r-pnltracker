/**
 * Navigation progress indicator.
 *
 * A bar rather than a spinner over the content: every screen here runs the P&L
 * engine over the full trade history in its loader, so a navigation can take a
 * moment, but the page you are leaving is still worth reading while it does.
 * Blanking it out would trade information for a spinner.
 *
 * Nothing appears for fast navigations. `defaultPreload: 'intent'` means most
 * routes are already warm by the time you click, and a bar that flashes for
 * 80ms reads as a glitch rather than as progress.
 */
import { useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import styles from './RouteProgress.module.scss'

/** Below this, a navigation is perceived as instant and gets no indicator. */
const APPEAR_AFTER_MS = 120

/**
 * Once shown, stay up at least this long.
 *
 * Without it a bar that appears at 121ms and vanishes at 130ms is a flicker —
 * worse than never having shown it.
 */
const MIN_VISIBLE_MS = 320

export function RouteProgress({ loading }: { loading: boolean }) {
  const [visible, setVisible] = useState(false)
  const shownAt = useRef<number | null>(null)

  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now()
        setVisible(true)
      }, APPEAR_AFTER_MS)
      return () => {
        clearTimeout(timer)
      }
    }

    // Loading finished. If the bar never appeared, there is nothing to hide.
    if (shownAt.current === null) {
      setVisible(false)
      return
    }

    const remaining = MIN_VISIBLE_MS - (Date.now() - shownAt.current)
    if (remaining <= 0) {
      shownAt.current = null
      setVisible(false)
      return
    }

    const timer = setTimeout(() => {
      shownAt.current = null
      setVisible(false)
    }, remaining)
    return () => {
      clearTimeout(timer)
    }
  }, [loading])

  return (
    <div
      className={styles.track}
      // Not `hidden`: the element stays mounted so the bar animates in and out
      // rather than popping.
      data-visible={visible ? 'true' : 'false'}
      // The bar is decorative; `aria-busy` on the content region is what
      // actually announces the state.
      aria-hidden="true"
    >
      <div className={styles.bar} />
    </div>
  )
}

/**
 * Whether a route change is in flight — for `aria-busy` and dimming.
 *
 * Both flags, not just `isLoading`: that covers the loader phase, while
 * `isTransitioning` covers React committing the new tree. Watching only the
 * first lets the indicator disappear while the screen is still the old one.
 *
 * Two things count as busy: opening a different screen, and changing `scope`.
 * A pathname check alone would miss the second — the sidebar's All/NISA/特定
 * switch navigates to the *same* path, and Dashboard, Positions, Stats and
 * Dividends all declare `scope` in `loaderDeps`, so it re-runs the engine on the
 * server and does need the indicator.
 *
 * `scope` is named explicitly because it is the only search param in the app
 * that drives a loader. Every other same-path param — Trades' filters, sorting
 * and paging — is applied to rows already in memory, so there is nothing to wait
 * for, yet they tripped the raw router flags all the same: every keystroke in
 * the Trades search box faded the page out from under the field being typed
 * into. Anything added to a `loaderDeps` later has to be added here too.
 */
export function useRouteLoading(): boolean {
  return useRouterState({
    select: (s) => {
      if (!s.isLoading && !s.isTransitioning) return false
      const from = s.resolvedLocation
      // Nothing resolved yet means the first load, which is a real one.
      if (!from) return true
      if (from.pathname !== s.location.pathname) return true
      return from.search.scope !== s.location.search.scope
    },
  })
}
