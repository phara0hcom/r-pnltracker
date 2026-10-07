/**
 * The remembered market is read through `useSyncExternalStore`, whose snapshot
 * React takes on every render of every subscriber. In a browser that blocks
 * storage, a snapshot that touched storage each time left a breadcrumb each
 * time — enough to push the trail behind a real error out of Sentry's buffer.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const breadcrumb = vi.fn<(message: string, data?: Record<string, unknown>) => void>()
vi.mock('~/lib/observability/report', () => ({
  breadcrumb: (message: string, data?: Record<string, unknown>) => {
    breadcrumb(message, data)
  },
}))

/** A fresh module, so its kept value starts unread, over the given storage. */
async function load(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  vi.resetModules()
  vi.stubGlobal('sessionStorage', storage)
  const module = await import('./rememberedMarket')
  function Probe() {
    return <p>{module.useRememberedMarketParam() ?? 'both'}</p>
  }
  return { ...module, Probe }
}

describe('rememberedMarket', () => {
  beforeEach(() => {
    breadcrumb.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads storage once, however often it renders', async () => {
    const getItem = vi.fn(() => 'US')
    const { Probe } = await load({ getItem, setItem: vi.fn(), removeItem: vi.fn() })
    const view = render(<Probe />)
    for (let i = 0; i < 5; i++) view.rerender(<Probe />)
    expect(screen.getByText('US')).toBeTruthy()
    expect(getItem).toHaveBeenCalledTimes(1)
  })

  it('leaves one breadcrumb, not one per render, when storage is blocked', async () => {
    const blocked = () => {
      throw new Error('SecurityError')
    }
    const { Probe, rememberMarket } = await load({ getItem: blocked, setItem: blocked, removeItem: blocked })
    const view = render(<Probe />)
    for (let i = 0; i < 5; i++) view.rerender(<Probe />)
    expect(screen.getByText('both')).toBeTruthy()
    expect(breadcrumb).toHaveBeenCalledTimes(1)

    // A choice still holds for the tab's links, though it cannot be stored.
    rememberMarket('JP')
    expect(await screen.findByText('JP')).toBeTruthy()
  })

  it('keeps ALL out of storage', async () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() }
    const { rememberMarket } = await load(storage)
    rememberMarket('US')
    expect(storage.setItem).toHaveBeenCalledWith('pnl.positions.market', 'US')
    rememberMarket('ALL')
    expect(storage.removeItem).toHaveBeenCalledWith('pnl.positions.market')
  })
})
