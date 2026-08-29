/**
 * Whether the viewport is phone-sized.
 *
 * Used where a breakpoint changes *what is rendered* rather than how it looks —
 * the filter controls move into a dialog on SP, and rendering both copies and
 * hiding one in CSS would put every input in the document twice: two identical
 * labelled controls, both in the tab order, both announced.
 *
 * Keep purely visual breakpoints in SCSS; this is only for the structural ones.
 */
import { useSyncExternalStore } from 'react'

/** Matches the `mobile` mixin in `styles/_mixins.scss`. Keep the two in step. */
const QUERY = '(width <= 640px)'

/**
 * One `MediaQueryList`, created on first use.
 *
 * Lazy rather than module-level: `matchMedia` does not exist on the server, and
 * this module is imported during SSR. `getSnapshot` runs on every render and on
 * every store check, so building a fresh list each time was pure allocation.
 */
let query: MediaQueryList | null = null
const media = (): MediaQueryList => (query ??= window.matchMedia(QUERY))

function subscribe(onChange: () => void): () => void {
  const list = media()
  list.addEventListener('change', onChange)
  return () => {
    list.removeEventListener('change', onChange)
  }
}

const getSnapshot = (): boolean => media().matches

/** The server has no viewport, so SSR renders the desktop arrangement. */
const getServerSnapshot = (): boolean => false

/**
 * `useSyncExternalStore` rather than state synced by an effect: `matchMedia` is
 * an external store, and this is the API for reading one without the extra
 * render — and without the cascading-render pattern `react-hooks` rejects.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
