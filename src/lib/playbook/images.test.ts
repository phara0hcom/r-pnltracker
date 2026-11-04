import { describe, expect, it } from 'vitest'
import {
  checkUpload,
  decodedLength,
  detectImageType,
  groupByPhase,
  imageFailureMessage,
  imagePathnames,
  MAX_UPLOAD_BASE64,
  MAX_UPLOAD_BYTES,
  scaledSize,
} from './images'

const bytes = (...values: number[]) => Uint8Array.from(values)
const text = (value: string) => new TextEncoder().encode(value)

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)
const WEBP = text('RIFF\0\0\0\0WEBPVP8 ')

describe('detectImageType', () => {
  it('reads the three formats from their bytes', () => {
    expect(detectImageType(PNG)).toBe('image/png')
    expect(detectImageType(JPEG)).toBe('image/jpeg')
    expect(detectImageType(WEBP)).toBe('image/webp')
  })

  it('refuses anything else, including what a browser would execute', () => {
    expect(detectImageType(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(detectImageType(text('<html><script>alert(1)</script>'))).toBeNull()
    expect(detectImageType(text('GIF89a'))).toBeNull()
    // RIFF is also WAV and AVI.
    expect(detectImageType(text('RIFF\0\0\0\0WAVEfmt '))).toBeNull()
    expect(detectImageType(new Uint8Array())).toBeNull()
  })

  it('does not read past a truncated signature as a match', () => {
    expect(detectImageType(bytes(0x89, 0x50))).toBeNull()
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull()
  })
})

describe('checkUpload', () => {
  const part = (data: Uint8Array, declared: string) => ({ bytes: data, declared })

  it('takes the type from the bytes', () => {
    expect(checkUpload(part(PNG, 'image/png'), part(PNG, 'image/png'))).toEqual({ type: 'image/png' })
  })

  it('never trusts the declared type', () => {
    expect(checkUpload(part(text('<html>'), 'image/png'), part(PNG, 'image/png'))).toEqual({
      problem: 'That is not a WebP, PNG or JPEG image.',
    })
    expect(checkUpload(part(PNG, 'image/webp'), part(PNG, 'image/webp'))).toEqual({
      problem: 'That file says it is image/webp, but its contents are image/png.',
    })
  })

  it('checks the thumbnail as well, since it is served too', () => {
    expect(checkUpload(part(PNG, 'image/png'), part(text('<svg/>'), 'image/png'))).toHaveProperty('problem')
    expect(checkUpload(part(PNG, 'image/png'), part(JPEG, 'image/png'))).toHaveProperty('problem')
  })

  it('caps the two files together, not each', () => {
    const half = (fill: number) => {
      const data = new Uint8Array(MAX_UPLOAD_BYTES / 2 + fill)
      data.set(PNG)
      return part(data, 'image/png')
    }
    expect(checkUpload(half(0), half(0))).toEqual({ type: 'image/png' })
    expect(checkUpload(half(0), half(1))).toEqual({ problem: 'An image and its thumbnail can be 3 MB together.' })
  })
})

describe('the size cap', () => {
  it('stays under Vercel’s 4.5 MB body limit once base64-encoded', () => {
    expect(MAX_UPLOAD_BASE64).toBeLessThan(4_500_000 - 2_000)
    expect(MAX_UPLOAD_BASE64).toBe(4_194_304)
  })

  it('measures a base64 string without decoding it', () => {
    for (const size of [0, 1, 2, 3, 4, 1000, 1001]) {
      expect(decodedLength(Buffer.alloc(size).toString('base64'))).toBe(size)
    }
  })
})

describe('scaledSize', () => {
  it('fits the long edge, keeping the shape', () => {
    expect(scaledSize(4000, 2000, 2000)).toEqual({ width: 2000, height: 1000 })
    expect(scaledSize(1000, 3000, 480)).toEqual({ width: 160, height: 480 })
  })

  it('never enlarges, and never rounds an edge away', () => {
    expect(scaledSize(800, 600, 2000)).toEqual({ width: 800, height: 600 })
    expect(scaledSize(5000, 1, 480)).toEqual({ width: 480, height: 1 })
  })
})

describe('imagePathnames', () => {
  it('files under the owner and position, with the extension of the bytes', () => {
    expect(imagePathnames('u1', 'j1', 'abc', 'image/jpeg')).toEqual({
      pathname: 'users/u1/j1/abc.jpg',
      thumbPathname: 'users/u1/j1/abc.thumb.jpg',
    })
  })
})

describe('groupByPhase', () => {
  it('orders by the trade, not by the input, and leaves out empty phases', () => {
    const groups = groupByPhase([
      { id: 'a', phase: 'EXIT' as const },
      { id: 'b', phase: 'PLAN' as const },
      { id: 'c', phase: 'EXIT' as const },
    ])
    expect(groups.map((group) => group.phase)).toEqual(['PLAN', 'EXIT'])
    expect(groups[1]?.images.map((image) => image.id)).toEqual(['a', 'c'])
  })
})

describe('imageFailureMessage', () => {
  it('says why, from what the route answered', () => {
    expect(imageFailureMessage(null)).toMatch(/Offline/)
    expect(imageFailureMessage(401)).toMatch(/Signed out/)
    expect(imageFailureMessage(404)).toMatch(/no longer in storage/)
    expect(imageFailureMessage(503)).toMatch(/unavailable or not configured/)
    expect(imageFailureMessage(200)).toMatch(/could not be displayed/)
  })
})
