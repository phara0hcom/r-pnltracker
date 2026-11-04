import { beforeEach, describe, expect, it, vi } from 'vitest'
import { serveImage } from './imageResponse'
import type { JournalImageRecord } from '~/db/playbook.service'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  allowed: vi.fn(),
  image: vi.fn(),
  get: vi.fn(),
  report: vi.fn(),
}))

vi.mock('~/lib/auth', () => ({ sessionForRequest: mocks.session, isAllowedEmail: mocks.allowed }))
vi.mock('~/db/playbook.service', () => ({ getJournalImage: mocks.image }))
vi.mock('~/db/imageStore', () => ({ get: mocks.get }))
vi.mock('~/lib/observability/report', () => ({ reportError: mocks.report }))

const row: JournalImageRecord = {
  id: 'img1',
  journalId: 'j1',
  phase: 'ENTRY',
  timeframe: '1D',
  caption: '',
  pathname: 'users/u1/j1/a.webp',
  thumbPathname: 'users/u1/j1/a.thumb.webp',
  contentType: 'image/webp',
  width: 100,
  height: 50,
}

const request = (query = '') => new Request(`http://localhost/api/images/img1${query}`)
const body = (text: string) => new Blob([text]).stream()

const expectGuarded = (response: Response) => {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'u1', email: 'owner@example.com' } })
  mocks.allowed.mockReturnValue(true)
  mocks.image.mockResolvedValue(row)
  mocks.get.mockImplementation((pathname: string) => Promise.resolve(body(pathname)))
})

describe('serveImage', () => {
  it('refuses without a session, before reading anything', async () => {
    mocks.session.mockResolvedValue(null)
    const response = await serveImage(request(), 'img1')
    expect(response.status).toBe(401)
    expectGuarded(response)
    expect(mocks.image).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('refuses a signed-in address no longer on the allowlist', async () => {
    mocks.allowed.mockReturnValue(false)
    expect((await serveImage(request(), 'img1')).status).toBe(401)
    expect(mocks.image).not.toHaveBeenCalled()
  })

  it('looks the row up by the session’s user, never by anything in the request', async () => {
    await serveImage(request(), 'img1')
    expect(mocks.image).toHaveBeenCalledWith('u1', 'img1')
  })

  it('answers a missing image and someone else’s identically', async () => {
    mocks.image.mockResolvedValue(null)
    const noRow = await serveImage(request(), 'img1')
    mocks.image.mockResolvedValue(row)
    mocks.get.mockResolvedValue(null)
    const noFile = await serveImage(request(), 'img1')
    expect(noRow.status).toBe(404)
    expect(noFile.status).toBe(404)
    expect(await noRow.text()).toBe(await noFile.text())
    expectGuarded(noRow)
  })

  it('streams the row’s type with nosniff and no-store', async () => {
    const response = await serveImage(request(), 'img1')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expectGuarded(response)
    expect(await response.text()).toBe('users/u1/j1/a.webp')
  })

  it('serves the thumbnail when asked, or the image if it has none', async () => {
    expect(await (await serveImage(request('?size=thumb'), 'img1')).text()).toBe('users/u1/j1/a.thumb.webp')
    mocks.image.mockResolvedValue({ ...row, thumbPathname: null })
    expect(await (await serveImage(request('?size=thumb'), 'img1')).text()).toBe('users/u1/j1/a.webp')
  })

  it('answers 503 and reports a storage failure instead of throwing', async () => {
    const outage = new Error('store down')
    mocks.get.mockRejectedValue(outage)
    const response = await serveImage(request(), 'img1')
    expect(response.status).toBe(503)
    expectGuarded(response)
    expect(mocks.report).toHaveBeenCalledWith(outage, { route: 'api.images' })
  })
})
