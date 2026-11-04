import { describe, expect, it } from 'vitest'
import { encodeCanvas } from './encodeImage'

/** A canvas that encodes each asked-for type as `produces` says, recording the asks. */
function fakeCanvas(produces: (type: string) => string | null) {
  const asked: [string, number][] = []
  return {
    asked,
    canvas: {
      toBlob: (callback: BlobCallback, type = '', quality = 0) => {
        asked.push([type, quality])
        const made = produces(type)
        callback(made ? new Blob(['x'], { type: made }) : null)
      },
    },
  }
}

describe('encodeCanvas', () => {
  it('uses WebP where the browser produces it', async () => {
    const { canvas, asked } = fakeCanvas((type) => type)
    expect((await encodeCanvas(canvas)).type).toBe('image/webp')
    expect(asked).toEqual([['image/webp', 0.85]])
  })

  it('falls back to JPEG when the canvas silently returns PNG, as Safari’s does', async () => {
    const { canvas, asked } = fakeCanvas((type) => (type === 'image/webp' ? 'image/png' : type))
    expect((await encodeCanvas(canvas)).type).toBe('image/jpeg')
    expect(asked).toEqual([
      ['image/webp', 0.85],
      ['image/jpeg', 0.9],
    ])
  })

  it('falls back when the canvas produces nothing at all', async () => {
    const { canvas } = fakeCanvas((type) => (type === 'image/webp' ? null : type))
    expect((await encodeCanvas(canvas)).type).toBe('image/jpeg')
  })

  it('refuses rather than sending a type it did not ask for', async () => {
    const { canvas } = fakeCanvas(() => 'image/png')
    await expect(encodeCanvas(canvas)).rejects.toThrow('could not encode')
  })
})
