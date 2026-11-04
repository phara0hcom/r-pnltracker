import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SetupDialog } from './SetupDialog'

const server = vi.hoisted(() => ({
  createSetupInline: vi.fn(),
  updateSetup: vi.fn(),
  archiveSetup: vi.fn(),
}))
vi.mock('~/server/playbook', () => server)

const SETUP = {
  id: 'setup-1',
  name: 'Pullback',
  description: 'To the 20d',
  criteria: [
    { id: 'c1', text: 'Uptrend' },
    { id: 'c2', text: 'Volume' },
  ],
}

function open(setup: typeof SETUP | null, handlers: { onClose?: () => void; onArchived?: () => void } = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SetupDialog setup={setup} onClose={handlers.onClose ?? vi.fn()} onArchived={handlers.onArchived} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  for (const fn of Object.values(server)) fn.mockReset().mockResolvedValue({ ok: true, id: 'new' })
})
afterEach(cleanup)

describe('SetupDialog', () => {
  it('keeps a renamed criterion’s id, drops a removed one and leaves a new one without', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    open(SETUP, { onClose })

    const first = screen.getByRole('textbox', { name: 'Criterion 1' })
    await user.clear(first)
    await user.type(first, 'Uptrend, 20d above 50d')
    await user.click(screen.getByRole('button', { name: /Remove\s*criterion 2/ }))
    await user.click(screen.getByRole('button', { name: 'Add a criterion' }))
    await user.type(screen.getByRole('textbox', { name: 'Criterion 2' }), 'Bounce candle')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
    expect(server.updateSetup).toHaveBeenCalledWith({
      data: {
        id: 'setup-1',
        name: 'Pullback',
        description: 'To the 20d',
        criteria: [
          { id: 'c1', text: 'Uptrend, 20d above 50d' },
          { id: undefined, text: 'Bounce candle' },
        ],
      },
    })
  })

  it('shows the server’s message on a duplicate name and stays open with what was typed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    server.createSetupInline.mockResolvedValue({ ok: false, message: 'There is already a setup called Breakout.' })
    open(null, { onClose })

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Breakout')
    await user.click(screen.getByRole('button', { name: 'Create setup' }))

    expect((await screen.findByRole('alert')).textContent).toBe('There is already a setup called Breakout.')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe('Breakout')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers archiving only on an existing setup, and only on a second click', async () => {
    const user = userEvent.setup()
    const onArchived = vi.fn()
    open(SETUP, { onArchived })

    const button = screen.getByRole('button', { name: 'Archive setup' })
    await user.click(button)
    expect(server.archiveSetup).not.toHaveBeenCalled()
    await user.click(button)
    await waitFor(() => {
      expect(onArchived).toHaveBeenCalled()
    })
    expect(server.archiveSetup).toHaveBeenCalledWith({ data: { id: 'setup-1' } })
    cleanup()

    open(null)
    expect(screen.queryByRole('button', { name: 'Archive setup' })).toBeNull()
  })

  it('will not submit without a name', () => {
    open(null)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create setup' }).disabled).toBe(true)
  })
})
