/**
 * What the offline banner promises, pinned.
 *
 * It is the only thing on screen that says the figures are not live, so each
 * way it could go quiet by mistake — or stay up by mistake — is a test here.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OfflineBanner } from './OfflineBanner'
import { getOffline, noteNothingSaved, noteSavedCopy, resetSavedCopy } from './offlineStore'

type NavigateListener = (event: { fromLocation?: object; hrefChanged: boolean }) => void

const router = vi.hoisted(() => ({
  listener: undefined as NavigateListener | undefined,
  invalidate: vi.fn(() => Promise.resolve()),
}))
const queryClient = vi.hoisted(() => ({ invalidateQueries: vi.fn(() => Promise.resolve()) }))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    subscribe: (_event: string, listener: NavigateListener) => {
      router.listener = listener
      return () => {
        router.listener = undefined
      }
    },
    invalidate: router.invalidate,
  }),
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => queryClient }))

const SAVED_AT = new Date(2026, 8, 13, 14, 2).getTime()
const banner = () => screen.getByRole('status').textContent

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  // The store outlives each render; a notice left up would leak into the next test.
  act(() => {
    resetSavedCopy()
    vi.advanceTimersByTime(60_000)
  })
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('OfflineBanner', () => {
  it('keeps its live region in place, empty, while every figure is live', () => {
    render(<OfflineBanner />)
    expect(banner()).toBe('')
  })

  it('shows the time of the oldest saved copy on screen', () => {
    render(<OfflineBanner />)
    act(() => {
      noteSavedCopy(SAVED_AT + 3_600_000)
      noteSavedCopy(SAVED_AT)
      noteSavedCopy(SAVED_AT + 60_000)
    })
    expect(banner()).toBe('Offline — showing figures saved 13 Sep, 14:02')
  })

  it('starts each new screen clean, but keeps what the first load reported', () => {
    render(<OfflineBanner />)
    act(() => {
      noteSavedCopy(SAVED_AT)
    })

    // The initial load has no `fromLocation`; a saved page read before hydration stays.
    act(() => router.listener?.({ hrefChanged: true }))
    expect(getOffline().savedAt).toBe(SAVED_AT)

    act(() => router.listener?.({ fromLocation: {}, hrefChanged: true }))
    expect(getOffline().savedAt).toBeNull()
    expect(banner()).toBe('')
  })

  it('reloads the screen live when the network returns', () => {
    render(<OfflineBanner />)
    act(() => {
      noteSavedCopy(SAVED_AT)
    })

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(router.invalidate).toHaveBeenCalledOnce()
    expect(queryClient.invalidateQueries).toHaveBeenCalledOnce()
    expect(banner()).toBe('')
  })

  it('leaves a live screen alone when the network returns', () => {
    render(<OfflineBanner />)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(router.invalidate).not.toHaveBeenCalled()
  })

  it('says an edit was not saved, and why, then lets it go', () => {
    render(<OfflineBanner />)

    act(() => {
      noteNothingSaved('offline')
    })
    expect(banner()).toBe('You’re offline — nothing was saved.')

    act(() => {
      noteNothingSaved('unreachable')
    })
    expect(banner()).toBe('Couldn’t reach the server — nothing was saved.')

    act(() => {
      vi.advanceTimersByTime(8_000)
    })
    expect(banner()).toBe('')
  })
})
