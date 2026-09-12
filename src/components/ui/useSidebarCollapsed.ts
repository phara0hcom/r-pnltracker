/**
 * Whether the desktop sidebar is collapsed to an icon rail.
 *
 * `localStorage` like the column widths and column visibility: a display
 * preference belongs to this browser, not to a URL someone might share.
 */
import { useCallback, useEffect, useState } from 'react'
import { breadcrumb } from '~/lib/observability/report'

const STORAGE_KEY = 'pnl.sidebar.collapsed'

function load(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    // Private browsing — the sidebar still collapses for this session. Left as a
    // breadcrumb rather than an event: this is the fallback working, and it is
    // only worth knowing about while explaining a later failure.
    breadcrumb('localStorage read failed', { key: STORAGE_KEY })
    return false
  }
}

export function useSidebarCollapsed(): [boolean, () => void] {
  // The server cannot read localStorage, so the first paint is expanded and the
  // stored value is adopted after mount — anything else is a hydration mismatch.
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setCollapsed(load())
  }, [])

  // Persisted here rather than inside the updater: a state updater has to be
  // pure, and React calls it twice under StrictMode.
  const toggle = useCallback(() => {
    const next = !collapsed
    setCollapsed(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next))
    } catch {
      // Storage unavailable; the choice still holds until reload.
      breadcrumb('localStorage write failed', { key: STORAGE_KEY })
    }
  }, [collapsed])

  return [collapsed, toggle]
}
