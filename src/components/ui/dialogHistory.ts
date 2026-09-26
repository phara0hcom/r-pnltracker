/**
 * Browser Back closes an open dialog, and Forward never reopens it.
 *
 * Opening a dialog adds a history entry for the same URL, carrying a mark. Back
 * leaves that entry, which closes the dialog and leaves the screen where it
 * was. Closing it any other way — ✕, Escape, Save — takes the entry back off,
 * so the next Back leaves the screen instead of doing nothing.
 *
 * None of this may reach the router. TanStack Router reloads on every history
 * notification, and on an unchanged URL it *forces* its loaders to re-run: an
 * entry per dialog would refetch the whole screen on each open and close, and
 * dim it while doing so. So the mark is written with the browser's own
 * `History.prototype` methods, which the router's history does not observe, and
 * a `popstate` listener that runs before the router's stops the moves between a
 * screen's entry and its dialog's from propagating. The dialog entry copies the
 * screen entry's router key and index, so in the router's terms the two are one
 * location.
 *
 * "Runs before" is the subtle part. Listeners on `window` run in the order they
 * were added — `capture` puts none ahead at the target — and the router's
 * history adds its own the moment it is made. So `historyWithDialogs` adds this
 * one first and then makes the router's history; `getRouter` hands the result
 * to the router.
 *
 * Two router writes still land while a dialog is open, and both are adjusted:
 *  - A push from a dialog's entry (a link in the navigation drawer) takes that
 *    entry's place, so Back from the new screen returns to the old one rather
 *    than to a copy of it.
 *  - A replace (a filter set in a sheet) keeps the mark, and when Back then
 *    closes the dialog, the entry underneath is brought up to the router's URL
 *    — otherwise Back would quietly undo the filter along with the sheet.
 *
 * Once a dialog has closed, its entry is dead. Forward onto it steps straight
 * back off, which is what makes Forward not reopen anything.
 */

/** The key the mark is stored under in `history.state`. */
export const DIALOG_MARK = '__pnlDialog'

type State = Record<string, unknown>

/** What this needs from the router's history: where it thinks it is, and a way to write out anything it has queued. */
export interface RouterHistoryLike {
  readonly location: { readonly href: string; readonly state: unknown }
  flush: () => void
}

export interface DialogHistoryEnv {
  /**
   * Routes every `popstate` to `onPop`, ahead of the router's own listener —
   * see `historyWithDialogs`.
   */
  listen: (onPop: (event: Event) => void) => void
  history: History
  router: RouterHistoryLike
  /**
   * Runs `fn` later and returns a cancel. A release is deferred so that a
   * StrictMode remount — cleanup and setup back to back — reclaims its entry
   * instead of popping it and pushing a new one.
   */
  defer: (fn: () => void) => () => void
}

export interface DialogHistory {
  /**
   * Adds the entry for an opening dialog and returns its token. Passing the
   * token of an entry still pending release reclaims it.
   */
  acquire: (existing: string | null, dismiss: () => void) => string
  /** Marks a dialog closed. Deferred; see `DialogHistoryEnv.defer`. */
  release: (token: string) => void
  /** Swaps the router's history for another — a new router in tests or after HMR. */
  useRouter: (router: RouterHistoryLike) => void
}

const asState = (value: unknown): State =>
  value !== null && typeof value === 'object' ? (value as State) : {}

const markOf = (state: unknown): string | null => {
  const mark = asState(state)[DIALOG_MARK]
  return typeof mark === 'string' ? mark : null
}

/** The router's entry key. A dialog entry copies its screen's. */
const keyOf = (state: unknown): unknown => asState(state).__TSR_key ?? asState(state).key

const indexOf = (state: unknown): unknown => asState(state).__TSR_index

const withoutMark = (state: unknown): State =>
  Object.fromEntries(Object.entries(asState(state)).filter(([key]) => key !== DIALOG_MARK))

let sequence = 0
const newToken = () => `${Date.now().toString(36)}-${(sequence++).toString(36)}`

export function createDialogHistory(env: DialogHistoryEnv): DialogHistory {
  const { history } = env
  let router = env.router

  // The browser's own methods: writes through these are invisible to the
  // router, whose history wraps the instance's methods, not the prototype's.
  const proto = Object.getPrototypeOf(history) as History
  const write = (state: State) => {
    proto.pushState.call(history, state, '')
  }
  const rewrite = (state: State, url?: string) => {
    proto.replaceState.call(history, state, '', url)
  }

  /** Open dialogs, by token, with what closes each. */
  const live = new Map<string, () => void>()
  /** Releases waiting to run, by token, with what cancels each. */
  const pending = new Map<string, () => void>()
  /** The mark of the entry the browser is on — `popstate` only says where it went. */
  let here = markOf(history.state)
  /** `popstate`s caused by this module's own `history.back()`. */
  let ownPops = 0

  const stepBack = () => {
    ownPops++
    history.back()
  }

  const close = (token: string) => {
    const dismiss = live.get(token)
    live.delete(token)
    dismiss?.()
  }

  /**
   * Keeps the router where it is across this `popstate`, and makes the entry
   * the browser landed on say so: if the router moved while the dialog was
   * open, the entry still holds the old URL.
   */
  const stay = (event: Event, landed: unknown) => {
    event.stopImmediatePropagation()
    if (keyOf(landed) !== keyOf(router.location.state)) {
      const mark = markOf(landed)
      const state = withoutMark(router.location.state)
      rewrite(mark == null ? state : { ...state, [DIALOG_MARK]: mark }, router.location.href)
    }
  }

  const onPop = (event: Event) => {
    const landed: unknown = (event as PopStateEvent).state ?? history.state
    const next = markOf(landed)
    const from = here
    here = next
    const sameEntry = keyOf(landed) != null && keyOf(landed) === keyOf(router.location.state)

    if (ownPops > 0) {
      // One this module asked for: the router already shows where it lands.
      ownPops--
      stay(event, landed)
      if (next != null && !live.has(next)) stepBack()
      return
    }

    if (from != null && live.has(from) && next !== from) {
      // Leaving an open dialog's entry. One step back — to the entry it was
      // opened over, which shares its index — closes it and nothing else.
      if (indexOf(landed) === indexOf(router.location.state)) {
        stay(event, landed)
        close(from)
        if (next != null && !live.has(next)) stepBack()
        return
      }
      // Several entries at once, from Back's history menu: a real navigation.
      close(from)
      return
    }

    if (next != null && !live.has(next)) {
      // Arrived on the entry of a dialog that has closed. Forward must not
      // reopen it, and staying would make the next Back a no-op.
      if (sameEntry) event.stopImmediatePropagation()
      stepBack()
      return
    }

    // Between a screen's entry and its dialog's: nothing for the router.
    if (sameEntry && (next != null || from != null)) event.stopImmediatePropagation()
  }

  const release = (token: string) => {
    pending.delete(token)
    // Already gone if Back closed it.
    if (!live.delete(token)) return
    // Closed from inside: take its entry off, or the next Back does nothing.
    if (markOf(history.state) === token) stepBack()
  }

  // The router's history wraps these on the instance; wrapping its wrappers
  // sees every write it makes, including the ones it queues and flushes later.
  const routerPush = history.pushState.bind(history)
  const routerReplace = history.replaceState.bind(history)
  history.pushState = function pushState(data: unknown, unused: string, url?: string | URL | null) {
    if (markOf(history.state) != null && markOf(data) == null) {
      here = null
      routerReplace(data, unused, url)
      return
    }
    routerPush(data, unused, url)
  }
  history.replaceState = function replaceState(data: unknown, unused: string, url?: string | URL | null) {
    const mark = markOf(history.state)
    const kept = mark != null && live.has(mark) && markOf(data) == null ? { ...asState(data), [DIALOG_MARK]: mark } : data
    routerReplace(kept, unused, url)
  }

  env.listen(onPop)

  return {
    acquire(existing, dismiss) {
      if (existing != null && pending.has(existing)) {
        pending.get(existing)?.()
        pending.delete(existing)
        live.set(existing, dismiss)
        return existing
      }
      // Anything the router has queued must land first, or it lands on top.
      router.flush()
      const token = newToken()
      const current = markOf(history.state)
      const state = { ...asState(history.state), [DIALOG_MARK]: token }
      if (current != null && pending.has(current)) {
        // One dialog handing over to another in the same commit (Edit on an
        // exit plan opens the plan form): take its entry rather than stack one.
        pending.get(current)?.()
        pending.delete(current)
        live.delete(current)
        rewrite(state)
      } else {
        write(state)
      }
      live.set(token, dismiss)
      here = token
      return token
    },
    release(token) {
      if (pending.has(token)) return
      pending.set(
        token,
        env.defer(() => {
          release(token)
        }),
      )
    },
    useRouter(next) {
      router = next
    },
  }
}

let shared: DialogHistory | null = null

const defer = (fn: () => void) => {
  const timer = setTimeout(fn, 0)
  return () => {
    clearTimeout(timer)
  }
}

/** Where each window's first `popstate` listener sends its events. */
const forwards = new WeakMap<object, (event: Event) => void>()

/**
 * Makes the router's browser history with this module's `popstate` listener
 * added ahead of the router's, and sets up the dialogs over it.
 *
 * The listener is added once per window and forwards to whichever instance is
 * current, so a router made again — a hot reload — does not stack a second.
 */
export function historyWithDialogs<H extends RouterHistoryLike>(
  create: () => H,
  win: Pick<Window, 'addEventListener' | 'history'> = window,
): H {
  if (!forwards.has(win)) {
    forwards.set(win, () => undefined)
    win.addEventListener('popstate', (event) => {
      forwards.get(win)?.(event)
    })
  }
  const router = create()
  shared = createDialogHistory({
    listen: (onPop) => {
      forwards.set(win, onPop)
    },
    history: win.history,
    router,
    defer,
  })
  return router
}

/**
 * This window's instance. Made by `historyWithDialogs` when the router is; made
 * here instead only where the router was built without it, and then its
 * listener comes after the router's — Back still closes a dialog, but the
 * router hears of it and reloads the screen.
 */
export function browserDialogHistory(router: RouterHistoryLike): DialogHistory {
  if (shared) {
    shared.useRouter(router)
    return shared
  }
  shared = createDialogHistory({
    listen: (onPop) => {
      window.addEventListener('popstate', onPop)
    },
    history: window.history,
    router,
    defer,
  })
  return shared
}
