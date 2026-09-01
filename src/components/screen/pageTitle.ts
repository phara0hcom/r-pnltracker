/**
 * The current screen's title, and whether it has scrolled out of sight.
 *
 * `AppShell` needs both to swap the brand for the page name on SP, but the
 * title lives in a `PageHeader` rendered deep inside `<main>` — there is no
 * prop path between them.
 *
 * A store rather than context, for a specific reason: registering a title
 * through context means a child calling `setState` inside an effect, which is
 * the cascading-render pattern `react-hooks/set-state-in-effect` rejects.
 * Writing to an external store from an effect is the sanctioned direction, and
 * `useSyncExternalStore` reads it back without the extra render.
 */

export interface PageTitleState {
  title: string | null
  /** True once the on-screen title has passed behind the sticky header. */
  scrolledPast: boolean
}

const EMPTY: PageTitleState = { title: null, scrolledPast: false }

let state: PageTitleState = EMPTY
const listeners = new Set<() => void>()

/**
 * A new object only when something actually changed.
 *
 * `useSyncExternalStore` compares snapshots by identity and re-renders on every
 * difference — returning a fresh object each read would loop forever.
 */
function set(next: PageTitleState): void {
  if (next.title === state.title && next.scrolledPast === state.scrolledPast) return
  state = next
  for (const listener of listeners) listener()
}

export function subscribePageTitle(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getPageTitle = (): PageTitleState => state

/** The server has no scroll position; SSR always renders the brand. */
export const getServerPageTitle = (): PageTitleState => EMPTY

export function setPageTitle(title: string | null): void {
  set({ title, scrolledPast: title === null ? false : state.scrolledPast })
}

export function setTitleScrolledPast(scrolledPast: boolean): void {
  set({ ...state, scrolledPast })
}
