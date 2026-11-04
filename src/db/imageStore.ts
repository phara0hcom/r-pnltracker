/**
 * The one place that stores images. Cloudflare R2 would slot in here.
 *
 *   - **Vercel Blob**, private, when `BLOB_STORE_ID` (OIDC, on Vercel) or
 *     `BLOB_READ_WRITE_TOKEN` (a static token, for local work against the real
 *     store) is set.
 *   - **Local disk** under a gitignored `.images/`, when neither is and this is
 *     not Vercel: development and the end-to-end check.
 *   - **Disabled** on Vercel when neither is set — a function's disk does not
 *     outlive it. The same contract as `TRADINGVIEW_WEBHOOK_SECRET`: unset turns
 *     the feature off rather than failing it.
 *
 * In `db/` because it does I/O, and `db/` is what `noServerCodeInClient()` guards.
 * Nothing reachable from a validator may import it.
 */
import { createReadStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { del as blobDel, get as blobGet, put as blobPut } from '@vercel/blob'

export type ImageStoreMode = 'BLOB' | 'DISK' | 'DISABLED'

export function imageStoreMode(env: NodeJS.ProcessEnv = process.env): ImageStoreMode {
  if (env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN) return 'BLOB'
  return env.VERCEL ? 'DISABLED' : 'DISK'
}

export type ImageStream = ReadableStream<Uint8Array>

interface Backend {
  put(pathname: string, body: Buffer, contentType: string): Promise<void>
  /** Null when nothing is stored there. */
  get(pathname: string): Promise<ImageStream | null>
  /** Something already gone is not a failure. */
  del(pathnames: readonly string[]): Promise<void>
}

const blobBackend: Backend = {
  put: async (pathname, body, contentType) => {
    // The pathname already carries a uuid, and is what the row records.
    await blobPut(pathname, body, { access: 'private', contentType, addRandomSuffix: false })
  },
  get: async (pathname) => (await blobGet(pathname, { access: 'private' }))?.stream ?? null,
  del: async (pathnames) => {
    await blobDel([...pathnames])
  },
}

export function diskBackend(root: string): Backend {
  const within = (pathname: string): string => {
    const path = resolve(root, pathname)
    // Pathnames are built on the server, but this is what stands between one and the filesystem.
    if (!path.startsWith(root + sep)) throw new Error('image pathname escapes the store')
    return path
  }
  return {
    put: async (pathname, body) => {
      const path = within(pathname)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
    },
    get: async (pathname) => {
      const path = within(pathname)
      try {
        await stat(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
      return Readable.toWeb(createReadStream(path)) as ImageStream
    },
    del: async (pathnames) => {
      await Promise.all(pathnames.map((pathname) => rm(within(pathname), { force: true })))
    },
  }
}

function backend(): Backend {
  const mode = imageStoreMode()
  if (mode === 'BLOB') return blobBackend
  if (mode === 'DISK') return diskBackend(resolve('.images'))
  throw new Error('Image storage is not configured.')
}

export const put = async (pathname: string, body: Buffer, contentType: string): Promise<void> =>
  backend().put(pathname, body, contentType)

export const get = async (pathname: string): Promise<ImageStream | null> => backend().get(pathname)

export const del = async (pathnames: readonly string[]): Promise<void> => backend().del(pathnames)
