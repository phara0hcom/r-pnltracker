/**
 * Images waiting to upload, or that failed to.
 *
 * Module state rather than a component's, because they have to outlive the Open
 * Position dialog: a position's id does not exist until its last step, so its
 * images upload after the create, and one that fails is retried from the position
 * page, which is a navigation away.
 *
 * Memory only. Nothing is written to the device, a reload forgets them, and
 * sign-out is a full page load, so the rule about holdings saved on a device is
 * not engaged. This is also not an offline queue: edits fail offline rather than
 * queue, so a failed image stays failed until the owner retries it.
 */
import { useSyncExternalStore } from 'react'
import type { EncodedPart } from './encodeImage'
import { validationMessage } from './usePlaybookAction'
import { reportError } from '~/lib/observability/report'
import type { ImagePhase } from '~/lib/playbook/types'
import { uploadImage } from '~/server/playbook'

export interface HeldImage {
  key: string
  name: string
  /** An object URL of the thumbnail; released when the image is dropped. */
  previewUrl: string
  image: EncodedPart
  thumb: EncodedPart
  phase: ImagePhase
  timeframe: string
  caption: string
}

export type HeldUpload = HeldImage & { status: 'WAITING' | 'UPLOADING' | 'FAILED'; problem: string | null }

const NONE: readonly HeldUpload[] = []
const queues = new Map<string, readonly HeldUpload[]>()
const listeners = new Set<() => void>()
const draining = new Set<string>()
const unseen = new Set<string>()

/**
 * Whether an image was saved since this position's page last asked. The page's
 * first data comes from its route loader, which no refresh can reach: an upload
 * landing after that read and before the page mounts would stay missing from the
 * gallery until a reload, with nothing left in the queue to say so.
 */
export const takeUnseenUploads = (journalId: string): boolean => unseen.delete(journalId)

function publish(journalId: string, next: readonly HeldUpload[]): void {
  if (next.length === 0) queues.delete(journalId)
  else queues.set(journalId, next)
  for (const listener of listeners) listener()
}

const queueOf = (journalId: string): readonly HeldUpload[] => queues.get(journalId) ?? NONE

function patch(journalId: string, key: string, change: Partial<HeldUpload>): void {
  publish(
    journalId,
    queueOf(journalId).map((item) => (item.key === key ? { ...item, ...change } : item)),
  )
}

export const releaseHeld = (image: Pick<HeldImage, 'previewUrl'>): void => {
  URL.revokeObjectURL(image.previewUrl)
}

function remove(journalId: string, key: string): void {
  const queue = queueOf(journalId)
  for (const item of queue) if (item.key === key) releaseHeld(item)
  publish(
    journalId,
    queue.filter((item) => item.key !== key),
  )
}

/** Null when saved; otherwise the sentence to show beside the image. */
async function attempt(journalId: string, held: HeldImage): Promise<string | null> {
  try {
    const result = await uploadImage({
      data: {
        journalId,
        phase: held.phase,
        timeframe: held.timeframe,
        caption: held.caption,
        image: held.image,
        thumb: held.thumb,
      },
    })
    return result.ok ? null : result.message
  } catch (error) {
    // `fetch` rejecting is the connection, not a fault worth an event.
    if (error instanceof TypeError) return 'Could not reach the server.'
    const refused = validationMessage(error)
    if (refused) return refused
    reportError(error, { mutation: 'playbook.uploadImage' })
    return 'The image could not be saved.'
  }
}

/** One at a time: each is already most of a function's body limit. */
async function drain(journalId: string, refresh: () => Promise<unknown>): Promise<void> {
  if (draining.has(journalId)) return
  draining.add(journalId)
  try {
    for (;;) {
      const next = queueOf(journalId).find((item) => item.status === 'WAITING')
      if (!next) return
      patch(journalId, next.key, { status: 'UPLOADING', problem: null })
      const problem = await attempt(journalId, next)
      if (problem) {
        patch(journalId, next.key, { status: 'FAILED', problem })
      } else {
        unseen.add(journalId)
        // Dropped only once the gallery has it, so it is never in neither place.
        await refresh().catch(() => undefined)
        remove(journalId, next.key)
      }
    }
  } finally {
    draining.delete(journalId)
  }
}

/** Takes the images over, preview URLs included. */
export function holdForUpload(journalId: string, images: readonly HeldImage[], refresh: () => Promise<unknown>): void {
  if (images.length === 0) return
  publish(journalId, [
    ...queueOf(journalId),
    ...images.map((image): HeldUpload => ({ ...image, status: 'WAITING', problem: null })),
  ])
  void drain(journalId, refresh)
}

export function retryHeld(journalId: string, key: string, refresh: () => Promise<unknown>): void {
  patch(journalId, key, { status: 'WAITING', problem: null })
  void drain(journalId, refresh)
}

export const discardHeld = remove

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useHeldImages(journalId: string): readonly HeldUpload[] {
  return useSyncExternalStore(
    subscribe,
    () => queueOf(journalId),
    () => NONE,
  )
}
