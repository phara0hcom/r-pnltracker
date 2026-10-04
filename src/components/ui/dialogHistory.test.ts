/**
 * Back closes a dialog, Forward never reopens it, and the router hears of
 * neither.
 *
 * Driven against a stand-in for the browser's history and for TanStack's
 * wrapper around it: the wrapper replaces the instance's `pushState` and
 * `replaceState` and listens for `popstate` without capture, exactly as
 * `@tanstack/history` does, so what the router would be told is observable.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  browserDialogHistory,
  createDialogHistory,
  DIALOG_MARK,
  historyWithDialogs,
  type RouterHistoryLike,
} from './dialogHistory'

type State = Record<string, unknown>
type Listener = (event: Event) => void

/**
 * `window` as far as `popstate` goes. Its listeners run in the order they were
 * added, `capture` or not — the event is dispatched at the window itself, and
 * that is what Chromium does there.
 */
class FakeWindow {
  private listeners: Listener[] = []

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (type !== 'popstate' || typeof listener !== 'function') return
    this.listeners.push(listener)
  }

  popstate(state: unknown) {
    let stopped = false
    const event = {
      state,
      stopImmediatePropagation: () => {
        stopped = true
      },
    } as unknown as Event
    for (const listener of [...this.listeners]) {
      if (stopped) break
      listener(event)
    }
  }
}

/** The browser's history. Its prototype methods are the "native" ones. */
class FakeHistory {
  entries: { state: State; url: string }[]
  index = 0
  scrollRestoration: ScrollRestoration = 'manual'
  private queue: number[] = []

  constructor(
    private win: FakeWindow,
    url: string,
    state: State,
  ) {
    this.entries = [{ state, url }]
  }

  get state(): State {
    return this.entries[this.index]!.state
  }

  get length() {
    return this.entries.length
  }

  get url() {
    return this.entries[this.index]!.url
  }

  pushState(state: unknown, _unused: string, url?: string | URL | null) {
    this.entries.splice(this.index + 1)
    this.entries.push({ state: state as State, url: url == null ? this.url : String(url) })
    this.index++
  }

  replaceState(state: unknown, _unused: string, url?: string | URL | null) {
    this.entries[this.index] = { state: state as State, url: url == null ? this.url : String(url) }
  }

  back() {
    this.queue.push(-1)
  }

  forward() {
    this.queue.push(1)
  }

  go(delta = 0) {
    this.queue.push(delta)
  }

  /** What the browser does after the current task: run queued moves, firing `popstate` for each. */
  settle() {
    for (let guard = 0; this.queue.length > 0 && guard < 20; guard++) {
      const to = this.index + (this.queue.shift() ?? 0)
      if (to < 0 || to >= this.entries.length) continue
      this.index = to
      this.win.popstate(this.state)
    }
  }
}

let keys = 0
const routerState = (index: number): State => {
  const key = `k${String(keys++)}`
  return { __TSR_index: index, key, __TSR_key: key }
}

/** TanStack Router's view of it: wraps the instance methods, listens for `popstate` without capture. */
function fakeRouter(win: FakeWindow, history: FakeHistory) {
  let location = { href: history.url, state: history.state as unknown }
  const heard: string[] = []
  let writing = false
  const native = FakeHistory.prototype

  history.pushState = function (state, unused, url) {
    native.pushState.call(history, state, unused, url)
    if (!writing) heard.push('push')
  }
  history.replaceState = function (state, unused, url) {
    native.replaceState.call(history, state, unused, url)
    if (!writing) heard.push('replace')
  }
  win.addEventListener('popstate', () => {
    location = { href: history.url, state: history.state }
    heard.push('pop')
  })

  const routerHistory: RouterHistoryLike = {
    get location() {
      return location
    },
    flush: () => undefined,
  }

  return {
    routerHistory,
    heard,
    /** A router navigation: it moves its own location, then writes through whatever `pushState` is now. */
    navigate(url: string, { replace = false } = {}) {
      const index = (location.state as State).__TSR_index as number
      const state = routerState(replace ? index : index + 1)
      location = { href: url, state }
      heard.push(replace ? 'navigate-replace' : 'navigate-push')
      writing = true
      if (replace) history.replaceState(state, '', url)
      else history.pushState(state, '', url)
      writing = false
    },
  }
}

function setup(entries?: { state: State; url: string }[], index?: number) {
  const win = new FakeWindow()
  const history = new FakeHistory(win, '/calendar', routerState(0))
  if (entries) {
    history.entries = entries
    history.index = index ?? entries.length - 1
  }
  // As in the browser: the dialogs' listener is added before the router's.
  let onPop: Listener = () => undefined
  win.addEventListener('popstate', (event) => {
    onPop(event)
  })
  const router = fakeRouter(win, history)
  const deferred: (() => void)[] = []
  const dialogs = createDialogHistory({
    listen: (listener) => {
      onPop = listener
    },
    history,
    router: router.routerHistory,
    defer: (fn) => {
      deferred.push(fn)
      return () => {
        deferred.splice(deferred.indexOf(fn), 1)
      }
    },
  })
  /** Lets deferred releases run, as a timeout would. */
  const flushDeferred = () => {
    for (const fn of deferred.splice(0)) fn()
  }
  return { win, history, router, dialogs, flushDeferred }
}

describe('historyWithDialogs', () => {
  it('listens ahead of the router history it makes, so the router never hears', () => {
    const win = new FakeWindow()
    const history = new FakeHistory(win, '/calendar', routerState(0))
    const made: { router?: ReturnType<typeof fakeRouter> } = {}
    const routerHistory = historyWithDialogs(
      () => {
        made.router = fakeRouter(win, history)
        return made.router.routerHistory
      },
      { addEventListener: win.addEventListener.bind(win), history },
    )
    const dialogs = browserDialogHistory(routerHistory)
    const dismiss = vi.fn()
    dialogs.acquire(null, dismiss)

    history.back()
    history.settle()

    expect(dismiss).toHaveBeenCalledTimes(1)
    expect(made.router?.heard).toEqual([])
  })
})

describe('dialog history', () => {
  it('adds an entry on open without telling the router', () => {
    const { history, router, dialogs } = setup()
    dialogs.acquire(null, vi.fn())

    expect(history.length).toBe(2)
    expect(history.url).toBe('/calendar')
    expect(history.state[DIALOG_MARK]).toEqual(expect.any(String))
    // The screen's router key and index, so the router sees one location.
    expect(history.state.__TSR_key).toBe(history.entries[0]!.state.__TSR_key)
    expect(router.heard).toEqual([])
  })

  it('closes the dialog on Back and keeps the router out of it', () => {
    const { history, router, dialogs } = setup()
    const dismiss = vi.fn()
    dialogs.acquire(null, dismiss)

    history.back()
    history.settle()

    expect(dismiss).toHaveBeenCalledTimes(1)
    expect(history.index).toBe(0)
    expect(router.heard).toEqual([])
  })

  it('does not reopen on Forward after Back closed it', () => {
    const { history, router, dialogs, flushDeferred } = setup()
    const dismiss = vi.fn()
    const token = dialogs.acquire(null, dismiss)
    history.back()
    history.settle()
    // The dialog unmounts, as it would once dismissed.
    dialogs.release(token)
    flushDeferred()

    history.forward()
    history.settle()

    expect(history.index).toBe(0)
    expect(dismiss).toHaveBeenCalledTimes(1)
    expect(router.heard).toEqual([])
  })

  it('takes its entry off when closed from inside, so the next Back leaves the screen', () => {
    const { history, router, dialogs, flushDeferred } = setup()
    const dismiss = vi.fn()
    const token = dialogs.acquire(null, dismiss)

    dialogs.release(token)
    flushDeferred()
    history.settle()

    expect(history.index).toBe(0)
    expect(dismiss).not.toHaveBeenCalled()
    expect(router.heard).toEqual([])

    // And Forward does not bring it back.
    history.forward()
    history.settle()
    expect(history.index).toBe(0)
    expect(router.heard).toEqual([])
  })

  it('keeps one entry through a StrictMode remount', () => {
    const { history, dialogs, flushDeferred } = setup()
    const dismiss = vi.fn()
    const token = dialogs.acquire(null, dismiss)
    dialogs.release(token)
    expect(dialogs.acquire(token, dismiss)).toBe(token)
    flushDeferred()
    history.settle()

    expect(history.length).toBe(2)
    expect(history.index).toBe(1)
    history.back()
    history.settle()
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('lets a navigation from a dialog take its entry, so Back returns to the screen underneath', () => {
    const { history, router, dialogs, flushDeferred } = setup()
    const token = dialogs.acquire(null, vi.fn())

    router.navigate('/positions')
    dialogs.release(token)
    flushDeferred()
    history.settle()

    expect(history.entries.map((entry) => entry.url)).toEqual(['/calendar', '/positions'])
    expect(history.index).toBe(1)

    history.back()
    history.settle()
    expect(history.url).toBe('/calendar')
    expect(router.heard).toEqual(['navigate-push', 'pop'])
  })

  it('keeps a URL the screen replaced while the dialog was open when Back closes it', () => {
    const { history, router, dialogs } = setup()
    const dismiss = vi.fn()
    dialogs.acquire(null, dismiss)

    router.navigate('/calendar?scope=NISA', { replace: true })
    expect(history.state[DIALOG_MARK]).toEqual(expect.any(String))

    history.back()
    history.settle()

    expect(dismiss).toHaveBeenCalledTimes(1)
    expect(history.index).toBe(0)
    // The filter survives: the entry underneath now says what the router shows.
    expect(history.url).toBe('/calendar?scope=NISA')
    expect(history.state.__TSR_key).toBe((router.routerHistory.location.state as State).__TSR_key)
    expect(history.state[DIALOG_MARK]).toBeUndefined()
    expect(router.heard).toEqual(['navigate-replace'])
  })

  it('hands one dialog entry over to the next in the same commit', () => {
    const { history, dialogs, flushDeferred } = setup()
    const first = vi.fn()
    const second = vi.fn()
    const plan = dialogs.acquire(null, first)
    dialogs.release(plan)
    dialogs.acquire(null, second)
    flushDeferred()
    history.settle()

    expect(history.length).toBe(2)
    history.back()
    history.settle()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(history.index).toBe(0)
  })

  it('treats a jump of several entries as a navigation', () => {
    const { history, router, dialogs } = setup()
    router.navigate('/calendar?month=2026-08')
    const dismiss = vi.fn()
    dialogs.acquire(null, dismiss)

    history.go(-2)
    history.settle()

    expect(dismiss).toHaveBeenCalledTimes(1)
    expect(history.index).toBe(0)
    expect(router.heard).toEqual(['navigate-push', 'pop'])
  })

  it('ignores a dialog entry left behind by a reload', () => {
    const screen = routerState(0)
    const { history, router } = setup(
      [
        { state: screen, url: '/calendar' },
        { state: { ...screen, [DIALOG_MARK]: 'stale' }, url: '/calendar' },
      ],
      1,
    )

    history.back()
    history.settle()
    expect(history.index).toBe(0)
    expect(router.heard).toEqual([])

    history.forward()
    history.settle()
    expect(history.index).toBe(0)
    expect(router.heard).toEqual([])
  })
})
