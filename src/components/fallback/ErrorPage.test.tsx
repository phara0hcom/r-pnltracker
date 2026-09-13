/**
 * The error page's way back from a lost connection, pinned.
 *
 * Offline it is the whole screen, and an installed app has no reload button of
 * its own — a dead end here stays one until the app is closed and reopened.
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorPage } from './ErrorPage'
import { reloadScreen } from '~/components/offline/offlineStore'

vi.mock('@sentry/tanstackstart-react', () => ({ captureException: vi.fn() }))
// jsdom cannot navigate, so the reload is observed rather than performed.
vi.mock('~/components/offline/offlineStore', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reloadScreen: vi.fn(),
}))

let online = true
const failedToFetch = () => new TypeError('Failed to fetch')
const heading = () => screen.getByRole('heading').textContent

beforeEach(() => {
  online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('ErrorPage', () => {
  it('offline, says the screen was not saved and offers to try again', async () => {
    online = false
    const user = userEvent.setup()
    render(<ErrorPage error={failedToFetch()} />)

    expect(heading()).toBe('You’re offline')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reloadScreen).toHaveBeenCalledOnce()
  })

  it('opens the screen again when the connection returns', () => {
    online = false
    render(<ErrorPage error={failedToFetch()} />)

    act(() => {
      online = true
      window.dispatchEvent(new Event('online'))
    })

    expect(reloadScreen).toHaveBeenCalledOnce()
    // The flag is back, but "Failed to fetch" is not what is happening.
    expect(heading()).toBe('Reconnecting…')
  })

  it('offers to try again when the server could not be reached', () => {
    render(<ErrorPage error={failedToFetch()} />)

    expect(heading()).toBe('Something went wrong')
    expect(screen.getByRole('button', { name: 'Try again' })).not.toBeNull()
  })

  it('leaves any other failure to say what it was', () => {
    render(<ErrorPage error={new Error('Engine failed')} />)

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(screen.getByText('Engine failed')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(reloadScreen).not.toHaveBeenCalled()
  })
})
