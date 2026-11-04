/**
 * What `/api/images/$id` answers. Apart from the route file so it can be tested
 * without the router.
 *
 * `no-store` because holdings saved on a device must be wiped on sign-out: the
 * browser's HTTP cache cannot be cleared from JavaScript, and a chart screenshot
 * shows the holding. Galleries use thumbnails, so re-fetching stays cheap.
 *
 * Nothing here may turn into a thrown error: an image failing to load is a
 * placeholder in its slot, never a broken page.
 */
import { get } from '~/db/imageStore'
import { getJournalImage } from '~/db/playbook.service'
import { reportError } from '~/lib/observability/report'

const HEADERS = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }

const refuse = (status: number, message: string): Response =>
  new Response(message, { status, headers: { ...HEADERS, 'content-type': 'text/plain; charset=utf-8' } })

export async function serveImage(request: Request, id: string): Promise<Response> {
  try {
    // Imported here for the reason `authed` does: see `docs/server-only-modules.md`.
    const { isAllowedEmail, sessionForRequest } = await import('~/lib/auth')
    const session = await sessionForRequest(request)
    if (!session?.user || !isAllowedEmail(session.user.email)) return refuse(401, 'Sign in to see this image.')

    // The same answer for a missing row and someone else's, so existence does not leak.
    const notFound = refuse(404, 'Not found.')
    const image = await getJournalImage(session.user.id, id)
    if (!image) return notFound

    const thumb = new URL(request.url).searchParams.get('size') === 'thumb'
    const stream = await get(thumb ? (image.thumbPathname ?? image.pathname) : image.pathname)
    if (!stream) return notFound

    // Streamed, which the 4.5 MB limit on a function's response does not cover.
    return new Response(stream, { headers: { ...HEADERS, 'content-type': image.contentType } })
  } catch (error) {
    reportError(error, { route: 'api.images' })
    return refuse(503, 'Image storage is unavailable.')
  }
}
