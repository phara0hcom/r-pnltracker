/**
 * Chart screenshots: the rules that need no browser and no storage.
 *
 * Client-safe, because the upload validator and the encoder both read it. Nothing
 * reachable from here may import `db/imageStore.ts`.
 */
import { IMAGE_PHASES, type ImagePhase } from './types'

export const MAX_IMAGE_EDGE = 2000
export const MAX_THUMB_EDGE = 480

/**
 * The image and its thumbnail together, decoded.
 *
 * Base64 adds a third, and a Vercel function's body stops at 4.5 MB, so 3 MB is
 * what still arrives once encoded. `MAX_FILE_BYTES` in `server/uploads.ts` is a
 * CSV's limit and would not: at 5 MB it is over the platform's once encoded.
 */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024
export const MAX_UPLOAD_BASE64 = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4

export type ImageType = 'image/webp' | 'image/png' | 'image/jpeg'

const EXTENSION: Record<ImageType, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
}

export const PHASE_LABEL: Record<ImagePhase, string> = {
  PLAN: 'Plan',
  ENTRY: 'Entry',
  DURING: 'During',
  EXIT: 'Exit',
}

export const MAX_TIMEFRAME = 8
export const MAX_CAPTION = 500
export const TIMEFRAME_SUGGESTIONS = ['1M', '1W', '1D', '4h', '1h', '15m', '5m', '1m']

/** One image as a gallery shows it. The URLs are the signed-in route's, never the store's. */
export interface GalleryImage {
  id: string
  phase: ImagePhase
  timeframe: string | null
  caption: string
  width: number | null
  height: number | null
  url: string
  thumbUrl: string
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  signature.every((byte, index) => bytes[offset + index] === byte)

const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0))

/** What the bytes are, whatever the request claimed. Null for anything else, SVG included. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp'
  return null
}

/** Decoded size of a base64 string, so the validator can refuse without decoding. */
export function decodedLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

export const UPLOAD_TOO_LARGE = `An image and its thumbnail can be ${String(MAX_UPLOAD_BYTES / 1024 / 1024)} MB together.`

interface UploadPart {
  bytes: Uint8Array
  declared: string
}

/**
 * The server's verdict on an upload: the type its bytes prove, or why not.
 *
 * The row holds one content type for both files, so they must agree. A declared
 * type that disagrees is refused, not corrected: the browser reports what its
 * canvas actually produced, so a mismatch means the bytes are not what was encoded.
 */
export function checkUpload(image: UploadPart, thumb: UploadPart): { type: ImageType } | { problem: string } {
  if (image.bytes.byteLength + thumb.bytes.byteLength > MAX_UPLOAD_BYTES) return { problem: UPLOAD_TOO_LARGE }
  const type = detectImageType(image.bytes)
  if (!type || detectImageType(thumb.bytes) !== type) {
    return { problem: 'That is not a WebP, PNG or JPEG image.' }
  }
  if (image.declared !== type || thumb.declared !== type) {
    return { problem: `That file says it is ${image.declared}, but its contents are ${type}.` }
  }
  return { type }
}

/** Fits within `maxEdge`, keeping its shape. Never enlarges. */
export function scaledSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function imagePathnames(
  userId: string,
  journalId: string,
  uuid: string,
  type: ImageType,
): { pathname: string; thumbPathname: string } {
  const base = `users/${userId}/${journalId}/${uuid}`
  return { pathname: `${base}.${EXTENSION[type]}`, thumbPathname: `${base}.thumb.${EXTENSION[type]}` }
}

/** In the order a trade happens, with empty phases left out. */
export function groupByPhase<T extends { phase: ImagePhase }>(images: readonly T[]): { phase: ImagePhase; images: T[] }[] {
  return IMAGE_PHASES.map((phase) => ({ phase, images: images.filter((image) => image.phase === phase) })).filter(
    (group) => group.images.length > 0,
  )
}

/**
 * Why an image slot is empty, from what re-requesting its URL answered. Null is a
 * request that never got an answer: the service worker passes `/api/*` straight
 * through, so offline there is no saved copy to fall back on.
 */
export function imageFailureMessage(status: number | null): string {
  if (status === null) return 'Offline — images are not saved on this device.'
  if (status === 401) return 'Signed out — sign in again to see this image.'
  if (status === 404) return 'This image is no longer in storage.'
  if (status === 503) return 'Image storage is unavailable or not configured.'
  return 'This image could not be displayed.'
}
