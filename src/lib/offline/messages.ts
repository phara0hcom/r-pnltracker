/**
 * How a page learns its figures came from the device, and how it words that.
 */

/** A response the page is about to use came from the saved copy, not the network. */
export interface SavedCopyMessage {
  type: 'pnl:saved-copy'
  /** When that copy was saved, in epoch milliseconds. */
  savedAt: number
}

/** Messages arrive as `unknown`; nothing reaches the store until it has this shape. */
export function isSavedCopyMessage(data: unknown): data is SavedCopyMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    data.type === 'pnl:saved-copy' &&
    'savedAt' in data &&
    typeof data.savedAt === 'number' &&
    Number.isFinite(data.savedAt)
  )
}

/** The `<meta>` every server-rendered page carries: when the server rendered it. */
export const RENDERED_AT_META = 'pnl-rendered-at'

/** A page rendered longer ago than this, by the phone's clock, is a saved copy. */
export const SAVED_PAGE_AGE_MS = 2 * 60_000

/**
 * When a page was saved, if it is a saved copy at all; null for a live render.
 *
 * The worker serves a saved page byte for byte, so the page cannot be told how
 * it arrived — only how old it is. A live render reaches the browser within
 * seconds; a saved one is as old as the visit that saved it.
 *
 * This compares the phone's clock with the server's, and that is the known
 * cost: a phone more than two minutes wrong misreads one as the other, and a
 * copy saved within the last two minutes goes unlabelled. Accepted so that the
 * worker never rewrites a page, and what hydrates is exactly what the server
 * rendered.
 */
export function savedPageTime(renderedAt: number, now: number): number | null {
  return now - renderedAt > SAVED_PAGE_AGE_MS ? renderedAt : null
}

/**
 * What `fetch` rejects with when no response arrived at all, in each engine:
 * Chromium, WebKit and Gecko respectively.
 */
const NETWORK_FAILURE = /failed to fetch|load failed|networkerror/i

/**
 * Whether a request failed for want of a network, rather than on the server.
 *
 * The message is checked as well as the type: a `TypeError` is also what a bug
 * in the calling code throws, and that must not be reported as a lost
 * connection.
 */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError && NETWORK_FAILURE.test(error.message)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "13 Sep, 14:02", in the device's own time zone.
 *
 * Spelled out rather than left to `Intl`, whose short month for September is
 * "Sept" in some locales and whose field order varies by all of them — the
 * banner reads the same everywhere.
 */
export function savedAtLabel(savedAt: Date): string {
  const hours = String(savedAt.getHours()).padStart(2, '0')
  const minutes = String(savedAt.getMinutes()).padStart(2, '0')
  return `${String(savedAt.getDate())} ${MONTHS[savedAt.getMonth()] ?? ''}, ${hours}:${minutes}`
}
