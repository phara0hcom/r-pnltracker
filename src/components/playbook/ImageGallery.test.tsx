import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageDrop } from './ImageDrop'
import { ImageGallery } from './ImageGallery'
import { StoredImage } from './StoredImage'
import type { GalleryImage } from '~/lib/playbook/images'

vi.mock('./encodeImage', () => ({
  encodeImageFile: vi.fn((file: File) =>
    file.name === 'broken.png'
      ? Promise.reject(new Error('broken.png could not be read as an image.'))
      : Promise.resolve({
          image: { base64: 'aW1n', contentType: 'image/webp', width: 10, height: 10 },
          thumb: { base64: 'dGh1', contentType: 'image/webp', width: 10, height: 10 },
          preview: new Blob(['x']),
        }),
  ),
}))

const image = (id: string, phase: GalleryImage['phase'], caption = ''): GalleryImage => ({
  id,
  phase,
  timeframe: '1D',
  caption,
  width: 2000,
  height: 1000,
  url: `/api/images/${id}`,
  thumbUrl: `/api/images/${id}?size=thumb`,
})

const IMAGES = [image('exit', 'EXIT', 'the exit'), image('plan', 'PLAN', 'the plan'), image('entry', 'ENTRY')]

const lightboxImage = () => within(screen.getByRole('dialog')).getByRole('img')

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ImageGallery', () => {
  it('groups by phase in the order of a trade', () => {
    render(<ImageGallery images={IMAGES} />)
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Plan', 'Entry', 'Exit'])
  })

  it('shows thumbnails, not the full image', () => {
    render(<ImageGallery images={[IMAGES[0]!]} />)
    expect(screen.getByRole('button').querySelector('img')?.getAttribute('src')).toBe('/api/images/exit?size=thumb')
  })

  it('drops the headings for a flat gallery, as the setup pages use', () => {
    render(<ImageGallery images={IMAGES} grouped={false} />)
    expect(screen.queryAllByRole('heading')).toEqual([])
  })

  it('opens the full image, moves with the arrow keys in display order, and stops at the ends', async () => {
    render(<ImageGallery images={IMAGES} />)
    await userEvent.click(screen.getByRole('button', { name: /the plan/ }))
    expect(lightboxImage().getAttribute('src')).toBe('/api/images/plan')
    expect(within(screen.getByRole('dialog')).getByText('1 of 3')).toBeTruthy()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' })
    expect(lightboxImage().getAttribute('src')).toBe('/api/images/plan')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' })
    expect(lightboxImage().getAttribute('src')).toBe('/api/images/entry')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' })
    expect(lightboxImage().getAttribute('src')).toBe('/api/images/exit')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' })
    expect(lightboxImage().getAttribute('src')).toBe('/api/images/exit')
  })

  it('moves with a swipe, and offers buttons for anyone who cannot', async () => {
    render(<ImageGallery images={IMAGES} />)
    await userEvent.click(screen.getByRole('button', { name: /the plan/ }))
    const stage = lightboxImage().parentElement!
    // Both lists, because Radix's scroll lock reads `changedTouches` on the way past.
    const at = (clientX: number) => [{ clientX, clientY: 100 }]
    fireEvent.touchStart(stage, { touches: at(300), changedTouches: at(300) })
    fireEvent.touchEnd(stage, { touches: [], changedTouches: at(100) })
    expect(lightboxImage().getAttribute('src')).toBe('/api/images/entry')
    await userEvent.click(screen.getByRole('button', { name: /Previous/ }))
    expect(lightboxImage().getAttribute('src')).toBe('/api/images/plan')
    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(lightboxImage().getAttribute('src')).toBe('/api/images/entry')
  })

  it('closes on Escape, back on the page that opened it', async () => {
    render(<ImageGallery images={IMAGES} />)
    await userEvent.click(screen.getByRole('button', { name: /the plan/ }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getAllByRole('heading')).toHaveLength(3)
  })

  it('closes rather than sliding to another image when the open one is deleted', async () => {
    const { rerender } = render(<ImageGallery images={IMAGES} />)
    await userEvent.click(screen.getByRole('button', { name: /the plan/ }))
    rerender(<ImageGallery images={IMAGES.filter((item) => item.id !== 'plan')} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('StoredImage', () => {
  it('says why when an image fails, from what the route answers', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 503 }))))
    render(<StoredImage src="/api/images/a" alt="chart" />)
    fireEvent.error(screen.getByRole('img'))
    expect(await screen.findByText('Image storage is unavailable or not configured.')).toBeTruthy()
  })

  it('says it is offline when the request gets no answer at all', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    render(<StoredImage src="/api/images/a" alt="chart" />)
    fireEvent.error(screen.getByRole('img'))
    expect(await screen.findByText('Offline — images are not saved on this device.')).toBeTruthy()
  })

  it('tries again when the connection returns', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    render(<StoredImage src="/api/images/a" alt="chart" />)
    fireEvent.error(screen.getByRole('img'))
    await screen.findByText(/Offline/)
    fireEvent(window, new Event('online'))
    expect(screen.getByRole('img').getAttribute('src')).toBe('/api/images/a')
  })

  it('catches an image that failed before hydration, which never fires onError', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 404 }))))
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    const current = vi.spyOn(HTMLImageElement.prototype, 'currentSrc', 'get').mockReturnValue('/api/images/a')
    render(<StoredImage src="/api/images/a" alt="chart" />)
    expect(await screen.findByText('This image is no longer in storage.')).toBeTruthy()
    complete.mockRestore()
    current.mockRestore()
  })
})

describe('ImageDrop', () => {
  const png = (name = 'chart.png') => new File(['x'], name, { type: 'image/png' })

  function paste(files: File[], target: EventTarget = document.body) {
    const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
    event.clipboardData = { files }
    target.dispatchEvent(event)
    return event
  }

  it('takes an image from a paste, under the phase it was given', async () => {
    const onImages = vi.fn()
    render(<ImageDrop phase="DURING" onImages={onImages} />)
    const event = paste([png()])
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => {
      expect(onImages).toHaveBeenCalledOnce()
    })
    expect(onImages.mock.calls[0]?.[0]).toMatchObject([{ name: 'chart.png', phase: 'DURING', previewUrl: 'blob:preview' }])
  })

  it('leaves a paste of text alone, so a note can still be pasted into', () => {
    const onImages = vi.fn()
    render(<ImageDrop phase="ENTRY" onImages={onImages} />)
    const event = paste([])
    expect(event.defaultPrevented).toBe(false)
    expect(onImages).not.toHaveBeenCalled()
  })

  it('on a page, ignores a paste while one of its dialogs is open', () => {
    const onImages = vi.fn()
    render(
      <>
        <ImageDrop phase="ENTRY" onImages={onImages} />
        <div role="dialog" />
      </>,
    )
    expect(paste([png()]).defaultPrevented).toBe(false)
    expect(onImages).not.toHaveBeenCalled()
  })

  it('inside a dialog, takes the paste', async () => {
    const onImages = vi.fn()
    render(
      <div role="dialog">
        <ImageDrop phase="ENTRY" onImages={onImages} />
      </div>,
    )
    expect(paste([png()]).defaultPrevented).toBe(true)
    await waitFor(() => {
      expect(onImages).toHaveBeenCalledOnce()
    })
  })

  it('stops listening once it is gone', () => {
    const onImages = vi.fn()
    const { unmount } = render(<ImageDrop phase="ENTRY" onImages={onImages} />)
    unmount()
    expect(paste([png()]).defaultPrevented).toBe(false)
  })

  it('takes a file from the picker, and a drop, refusing what is not an image', async () => {
    const onImages = vi.fn()
    const { container } = render(<ImageDrop phase="ENTRY" onImages={onImages} />)
    await userEvent.upload(container.querySelector('input[type="file"]')!, png('picked.png'))
    await waitFor(() => {
      expect(onImages).toHaveBeenCalledOnce()
    })

    const pdf = new File(['%PDF'], 'statement.pdf', { type: 'application/pdf' })
    fireEvent.drop(container.querySelector('[role="presentation"]')!, {
      dataTransfer: { files: [pdf, png('dropped.png')] },
    })
    await screen.findByText('statement.pdf is not an image.')
    await waitFor(() => {
      expect(onImages).toHaveBeenCalledTimes(2)
    })
    expect(onImages.mock.calls[1]?.[0]).toMatchObject([{ name: 'dropped.png' }])
  })

  it('names a file that could not be decoded', async () => {
    const { container } = render(<ImageDrop phase="ENTRY" onImages={vi.fn()} />)
    await userEvent.upload(container.querySelector('input[type="file"]')!, png('broken.png'))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('broken.png could not be read as an image.')
  })
})
