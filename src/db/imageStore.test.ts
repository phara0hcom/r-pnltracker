import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { del, diskBackend, get, imageStoreMode, put, type ImageStream } from './imageStore'

const blob = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }))
vi.mock('@vercel/blob', () => blob)

describe('imageStoreMode', () => {
  it('uses Blob when a store id or a static token is set, on or off Vercel', () => {
    expect(imageStoreMode({ BLOB_STORE_ID: 'store_x', VERCEL: '1' })).toBe('BLOB')
    expect(imageStoreMode({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x' })).toBe('BLOB')
  })

  it('uses the disk locally when neither is set', () => {
    expect(imageStoreMode({})).toBe('DISK')
  })

  it('is disabled on Vercel when neither is set, whose disk does not last', () => {
    expect(imageStoreMode({ VERCEL: '1' })).toBe('DISABLED')
  })

  it('treats a blank variable as unset', () => {
    expect(imageStoreMode({ BLOB_STORE_ID: '', VERCEL: '1' })).toBe('DISABLED')
  })
})

describe('the disk store', () => {
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pnl-images-'))
  })
  afterAll(() => rm(root, { recursive: true, force: true }))

  const read = async (stream: ImageStream | null): Promise<string | null> =>
    stream ? new Response(stream).text() : null

  it('round-trips under nested folders', async () => {
    const store = diskBackend(root)
    await store.put('users/u1/j1/a.webp', Buffer.from('bytes'), 'image/webp')
    expect(await read(await store.get('users/u1/j1/a.webp'))).toBe('bytes')
  })

  it('answers null for nothing stored, not an error', async () => {
    expect(await diskBackend(root).get('users/u1/j1/missing.webp')).toBeNull()
  })

  it('deletes, and does not mind what is already gone', async () => {
    const store = diskBackend(root)
    await store.put('users/u1/j2/a.webp', Buffer.from('a'), 'image/webp')
    await store.del(['users/u1/j2/a.webp', 'users/u1/j2/never-there.webp'])
    expect(await store.get('users/u1/j2/a.webp')).toBeNull()
  })

  it('refuses a pathname that climbs out of the store', async () => {
    const store = diskBackend(root)
    await expect(store.get('../outside.webp')).rejects.toThrow('escapes the store')
    await expect(store.put('users/../../outside.webp', Buffer.from('a'), 'image/webp')).rejects.toThrow('escapes')
    await expect(store.del(['../outside.webp'])).rejects.toThrow('escapes')
  })
})

describe('the Blob store', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('BLOB_STORE_ID', 'store_x')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('writes privately at exactly the pathname the row records', async () => {
    const body = Buffer.from('bytes')
    await put('users/u1/j1/a.webp', body, 'image/webp')
    expect(blob.put).toHaveBeenCalledWith('users/u1/j1/a.webp', body, {
      access: 'private',
      contentType: 'image/webp',
      addRandomSuffix: false,
    })
  })

  it('reads privately, answering with the stream or null', async () => {
    const stream = new Blob(['x']).stream()
    blob.get.mockResolvedValueOnce({ statusCode: 200, stream }).mockResolvedValueOnce(null)
    expect(await get('users/u1/j1/a.webp')).toBe(stream)
    expect(blob.get).toHaveBeenCalledWith('users/u1/j1/a.webp', { access: 'private' })
    expect(await get('users/u1/j1/gone.webp')).toBeNull()
  })

  it('deletes every pathname in one call', async () => {
    await del(['a.webp', 'a.thumb.webp'])
    expect(blob.del).toHaveBeenCalledWith(['a.webp', 'a.thumb.webp'])
  })

  it('refuses when disabled, so a caller reports it instead of writing nowhere', async () => {
    vi.stubEnv('BLOB_STORE_ID', '')
    vi.stubEnv('VERCEL', '1')
    await expect(get('a.webp')).rejects.toThrow('not configured')
    await expect(del(['a.webp'])).rejects.toThrow('not configured')
    await expect(put('a.webp', Buffer.from('x'), 'image/webp')).rejects.toThrow('not configured')
    expect(blob.put).not.toHaveBeenCalled()
  })
})
