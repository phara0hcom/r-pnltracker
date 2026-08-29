/**
 * The invariant worth pinning is snapshot identity.
 *
 * `useSyncExternalStore` compares snapshots by reference and re-renders on
 * every difference, so a store that hands back a fresh object per read loops
 * forever — in the app shell, on every screen. The rest of these cover the
 * lifecycle `PageHeader` drives: register on mount, clear on unmount.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPageTitle,
  getServerPageTitle,
  setPageTitle,
  setTitleScrolledPast,
  subscribePageTitle,
} from './pageTitle'

beforeEach(() => {
  setPageTitle(null)
})

describe('snapshot identity', () => {
  it('returns the same object when nothing changed', () => {
    setPageTitle('Positions')
    const first = getPageTitle()
    setPageTitle('Positions')
    // Reference equality, not deep: a new object here is an infinite loop.
    expect(getPageTitle()).toBe(first)
  })

  it('returns a new object when something did change', () => {
    setPageTitle('Positions')
    const first = getPageTitle()
    setPageTitle('Trades')
    expect(getPageTitle()).not.toBe(first)
  })

  it('does not notify subscribers for a no-op write', () => {
    setPageTitle('Positions')
    const listener = vi.fn()
    subscribePageTitle(listener)
    setPageTitle('Positions')
    setTitleScrolledPast(false)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('subscription', () => {
  it('notifies on a real change and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribePageTitle(listener)

    setPageTitle('Stats')
    expect(listener).toHaveBeenCalledTimes(1)

    setTitleScrolledPast(true)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    setPageTitle('Tax')
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('lifecycle', () => {
  it('starts with nothing to show', () => {
    expect(getPageTitle()).toEqual({ title: null, scrolledPast: false })
  })

  it('clearing the title also clears the scroll state', () => {
    // `PageHeader` clears on unmount. Leaving `scrolledPast` set would let the
    // next screen's header open already showing a page name it has not set yet.
    setPageTitle('Dividends')
    setTitleScrolledPast(true)
    setPageTitle(null)
    expect(getPageTitle()).toEqual({ title: null, scrolledPast: false })
  })

  it('keeps the scroll state when only the title changes', () => {
    setPageTitle('Positions')
    setTitleScrolledPast(true)
    setPageTitle('Trades')
    expect(getPageTitle()).toEqual({ title: 'Trades', scrolledPast: true })
  })

  it('renders the brand on the server, which has no scroll position', () => {
    setPageTitle('Positions')
    setTitleScrolledPast(true)
    expect(getServerPageTitle()).toEqual({ title: null, scrolledPast: false })
  })
})
