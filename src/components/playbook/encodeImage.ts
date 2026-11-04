/**
 * Turns a dropped, pasted or picked file into what `uploadImage` accepts: the
 * image at 2000 px and a thumbnail at 480 px, encoded on a canvas.
 *
 * WebP where the browser can. Safari's canvas cannot encode it and silently hands
 * back PNG, far larger for a chart, so the type that came back is what decides,
 * never the type that was asked for.
 */
import {
  MAX_IMAGE_EDGE,
  MAX_THUMB_EDGE,
  MAX_UPLOAD_BYTES,
  scaledSize,
  UPLOAD_TOO_LARGE,
} from '~/lib/playbook/images'

const WEBP_QUALITY = 0.85
const JPEG_QUALITY = 0.9

type BlobCanvas = Pick<HTMLCanvasElement, 'toBlob'>

const toBlob = (canvas: BlobCanvas, type: string, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality)
  })

/** The smallest format this browser actually produces. */
export async function encodeCanvas(canvas: BlobCanvas): Promise<Blob> {
  const webp = await toBlob(canvas, 'image/webp', WEBP_QUALITY)
  if (webp?.type === 'image/webp') return webp
  const jpeg = await toBlob(canvas, 'image/jpeg', JPEG_QUALITY)
  if (jpeg?.type === 'image/jpeg') return jpeg
  throw new Error('This browser could not encode the image.')
}

/** The thumbnail matches its image, because the row records one type for both. */
async function encodeSame(canvas: BlobCanvas, type: string): Promise<Blob> {
  const blob = await toBlob(canvas, type, type === 'image/webp' ? WEBP_QUALITY : JPEG_QUALITY)
  if (blob?.type !== type) throw new Error('This browser could not encode the image.')
  return blob
}

const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // A data URL: everything after the comma is the base64.
      resolve((reader.result as string).split(',')[1] ?? '')
    }
    reader.onerror = () => {
      reject(new Error('The image could not be read.'))
    }
    reader.readAsDataURL(blob)
  })

function draw(source: ImageBitmap, maxEdge: number): HTMLCanvasElement {
  const { width, height } = scaledSize(source.width, source.height, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not encode the image.')
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, width, height)
  return canvas
}

export interface EncodedPart {
  base64: string
  contentType: string
  width: number
  height: number
}

export interface EncodedImage {
  image: EncodedPart
  thumb: EncodedPart
  /** The thumbnail, for showing it before it has been uploaded. */
  preview: Blob
}

export async function encodeImageFile(file: File): Promise<EncodedImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(`${file.name} could not be read as an image.`)
  }
  try {
    const imageCanvas = draw(bitmap, MAX_IMAGE_EDGE)
    const thumbCanvas = draw(bitmap, MAX_THUMB_EDGE)
    const image = await encodeCanvas(imageCanvas)
    const thumb = await encodeSame(thumbCanvas, image.type)
    if (image.size + thumb.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name}: ${UPLOAD_TOO_LARGE}`)
    const part = async (blob: Blob, canvas: HTMLCanvasElement): Promise<EncodedPart> => ({
      base64: await toBase64(blob),
      contentType: blob.type,
      width: canvas.width,
      height: canvas.height,
    })
    return { image: await part(image, imageCanvas), thumb: await part(thumb, thumbCanvas), preview: thumb }
  } finally {
    bitmap.close()
  }
}
