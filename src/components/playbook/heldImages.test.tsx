import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { discardHeld, holdForUpload, takeUnseenUploads, type HeldImage } from './heldImages'
import { HeldUploads } from './HeldUploads'
import { PositionCharts } from './PositionCharts'

const mocks = vi.hoisted(() => ({ upload: vi.fn(), report: vi.fn(), revoke: vi.fn() }))

vi.mock('~/server/playbook', () => ({ uploadImage: mocks.upload }))
vi.mock('~/lib/observability/report', () => ({ reportError: mocks.report }))

let sequence = 0
const held = (name: string): HeldImage => ({
  key: `key-${String((sequence += 1))}`,
  name,
  previewUrl: `blob:${name}`,
  image: { base64: 'aW1n', contentType: 'image/webp', width: 2000, height: 1000 },
  thumb: { base64: 'dGh1', contentType: 'image/webp', width: 480, height: 240 },
  phase: 'ENTRY',
  timeframe: '1D',
  caption: name,
})

function show(journalId: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <HeldUploads journalId={journalId} />
    </QueryClientProvider>,
  )
}

const refresh = () => Promise.resolve()

beforeEach(() => {
  vi.resetAllMocks()
  URL.revokeObjectURL = mocks.revoke
})
afterEach(cleanup)

describe('holding images for upload', () => {
  it('uploads them in order, one at a time, then forgets them', async () => {
    let inFlight = 0
    let most = 0
    const names: string[] = []
    mocks.upload.mockImplementation(async ({ data }: { data: { caption: string } }) => {
      inFlight += 1
      most = Math.max(most, inFlight)
      names.push(data.caption)
      await Promise.resolve()
      inFlight -= 1
      return { ok: true, id: 'x' }
    })
    show('j-order')
    act(() => {
      holdForUpload('j-order', [held('first.png'), held('second.png'), held('third.png')], refresh)
    })
    await waitFor(() => {
      expect(screen.queryByRole('listitem')).toBeNull()
    })
    expect(names).toEqual(['first.png', 'second.png', 'third.png'])
    expect(most).toBe(1)
    expect(mocks.revoke).toHaveBeenCalledTimes(3)
  })

  it('sends the position it was given and the labels the owner set', async () => {
    mocks.upload.mockResolvedValue({ ok: true, id: 'x' })
    show('j-send')
    act(() => {
      holdForUpload('j-send', [held('a.png')], refresh)
    })
    await waitFor(() => {
      expect(mocks.upload).toHaveBeenCalledOnce()
    })
    expect(mocks.upload.mock.calls[0]?.[0]).toMatchObject({
      data: { journalId: 'j-send', phase: 'ENTRY', timeframe: '1D', caption: 'a.png' },
    })
  })

  it('names each image that failed and why, carrying on with the rest', async () => {
    mocks.upload
      .mockResolvedValueOnce({ ok: false, message: 'Image storage is unavailable, so the image was not saved.' })
      .mockResolvedValueOnce({ ok: true, id: 'x' })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    show('j-fail')
    act(() => {
      holdForUpload('j-fail', [held('bad.png'), held('good.png'), held('offline.png')], refresh)
    })
    await screen.findByText(/Could not reach the server/)
    expect(screen.getByText('bad.png')).toBeTruthy()
    expect(screen.getByText(/Image storage is unavailable/)).toBeTruthy()
    expect(screen.getByText('offline.png')).toBeTruthy()
    expect(screen.queryByText('good.png')).toBeNull()
    expect(screen.getByText(/The position is saved/)).toBeTruthy()
    // A dropped connection is not a fault worth an event.
    expect(mocks.report).not.toHaveBeenCalled()
  })

  it('retries one that failed from the page, with the same bytes', async () => {
    mocks.upload.mockResolvedValueOnce({ ok: false, message: 'down' }).mockResolvedValueOnce({ ok: true, id: 'x' })
    show('j-retry')
    act(() => {
      holdForUpload('j-retry', [held('chart.png')], refresh)
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(screen.queryByText('chart.png')).toBeNull()
    })
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.upload.mock.calls[1]?.[0]).toEqual(mocks.upload.mock.calls[0]?.[0])
  })

  it('keeps an image in view until the gallery has refreshed', async () => {
    mocks.upload.mockResolvedValue({ ok: true, id: 'x' })
    let refreshed: () => void = () => undefined
    const slow = () =>
      new Promise<void>((resolve) => {
        refreshed = resolve
      })
    show('j-gap')
    act(() => {
      holdForUpload('j-gap', [held('chart.png')], slow)
    })
    await waitFor(() => {
      expect(mocks.upload).toHaveBeenCalled()
    })
    expect(screen.getByText('chart.png')).toBeTruthy()
    await act(async () => {
      await Promise.resolve()
      refreshed()
    })
    await waitFor(() => {
      expect(screen.queryByText('chart.png')).toBeNull()
    })
  })

  it('discards one for good, releasing its preview', async () => {
    mocks.upload.mockResolvedValue({ ok: false, message: 'down' })
    show('j-discard')
    act(() => {
      holdForUpload('j-discard', [held('chart.png')], refresh)
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(screen.queryByText('chart.png')).toBeNull()
    expect(mocks.revoke).toHaveBeenCalledWith('blob:chart.png')
    act(() => {
      discardHeld('j-discard', 'never-held')
    })
  })

  it('refreshes a page that mounts after an upload it could not have seen', async () => {
    mocks.upload.mockResolvedValue({ ok: true, id: 'x' })
    show('j-late')
    act(() => {
      holdForUpload('j-late', [held('chart.png')], refresh)
    })
    await waitFor(() => {
      expect(screen.queryByText('chart.png')).toBeNull()
    })
    cleanup()

    const mount = () => {
      const client = new QueryClient()
      const invalidate = vi.spyOn(client, 'invalidateQueries')
      const page = render(
        <QueryClientProvider client={client}>
          <PositionCharts journalId="j-late" images={[]} enabled archived={false} />
        </QueryClientProvider>,
      )
      page.unmount()
      return invalidate
    }
    expect(mount()).toHaveBeenCalledWith({ queryKey: ['playbook', 'position', 'j-late'] })
    // Once is enough: an ordinary later visit costs no extra fetch.
    expect(mount()).not.toHaveBeenCalled()
  })

  it('has nothing for the page to refresh after an upload that failed', async () => {
    mocks.upload.mockResolvedValue({ ok: false, message: 'down' })
    show('j-unsaved')
    act(() => {
      holdForUpload('j-unsaved', [held('chart.png')], refresh)
    })
    await screen.findByRole('button', { name: 'Retry' })
    expect(takeUnseenUploads('j-unsaved')).toBe(false)
  })

  it('shows nothing when nothing is held, and keeps positions apart', () => {
    mocks.upload.mockReturnValue(new Promise(() => undefined))
    const { container } = show('j-empty')
    act(() => {
      holdForUpload('j-elsewhere', [held('other.png')], refresh)
    })
    expect(container.textContent).toBe('')
  })
})
