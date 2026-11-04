/**
 * Adding chart screenshots: paste, drag-drop or the file picker.
 *
 * Paste listens on the document, because TradingView's "copy chart image" leaves
 * the owner in another window with nothing here focused. It takes only a clipboard
 * holding an image, so pasting text into a note is untouched, and only when this
 * control is what the screen is showing: a drop on a page ignores a paste made
 * while one of that page's dialogs is open.
 *
 * It only encodes. The caller decides what becomes of the result, since the dialog
 * holds its images until the position exists and the position page sends them at once.
 */
import { useEffect, useRef, useState } from 'react'
import { encodeImageFile } from './encodeImage'
import type { HeldImage } from './heldImages'
import styles from './Images.module.scss'
import { cx } from '~/lib/cx'
import type { ImagePhase } from '~/lib/playbook/types'

const isImage = (file: File): boolean => file.type.startsWith('image/')

async function hold(file: File, phase: ImagePhase): Promise<HeldImage> {
  const encoded = await encodeImageFile(file)
  return {
    key: crypto.randomUUID(),
    name: file.name,
    previewUrl: URL.createObjectURL(encoded.preview),
    image: encoded.image,
    thumb: encoded.thumb,
    phase,
    timeframe: '',
    caption: '',
  }
}

export function ImageDrop({ phase, onImages }: { phase: ImagePhase; onImages: (images: HeldImage[]) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [encoding, setEncoding] = useState(0)
  const [problems, setProblems] = useState<string[]>([])

  const accept = async (files: readonly File[]) => {
    setProblems([])
    setEncoding((count) => count + files.length)
    const held: HeldImage[] = []
    const refused: string[] = []
    for (const file of files) {
      try {
        if (!isImage(file)) throw new Error(`${file.name} is not an image.`)
        held.push(await hold(file, phase))
      } catch (error) {
        refused.push(error instanceof Error ? error.message : `${file.name} could not be read.`)
      }
      setEncoding((count) => count - 1)
    }
    setProblems(refused)
    if (held.length > 0) onImages(held)
  }

  // The latest closure, without re-subscribing on every render.
  const latest = useRef(accept)
  useEffect(() => {
    latest.current = accept
  })

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const own = root.current?.closest('[role="dialog"]')
      if (!own && document.querySelector('[role="dialog"]')) return
      const images = Array.from(event.clipboardData?.files ?? []).filter(isImage)
      if (images.length === 0) return
      event.preventDefault()
      void latest.current(images)
    }
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('paste', onPaste)
    }
  }, [])

  return (
    <div ref={root} className={styles.dropArea}>
      <div
        className={cx(styles.drop, dragging && styles.dropActive)}
        role="presentation"
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => {
          setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void accept(Array.from(event.dataTransfer.files))
        }}
      >
        <span>Paste a chart, drop images here, or</span>
        <label className={styles.fileButton}>
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            className="visually-hidden"
            onChange={(event) => {
              void accept(Array.from(event.target.files ?? []))
              // Reset so re-choosing the same file still fires a change event.
              event.target.value = ''
            }}
          />
          choose files
        </label>
      </div>
      {encoding > 0 ? <p className={styles.muted}>Preparing {encoding === 1 ? 'an image' : `${String(encoding)} images`}…</p> : null}
      {problems.map((problem) => (
        <p key={problem} className={styles.problem} role="alert">
          {problem}
        </p>
      ))}
    </div>
  )
}

/** Where the upload control would be, when no store is configured. */
export function ImagesNotConfigured() {
  return <p className={styles.muted}>Image storage is not configured, so charts cannot be added here.</p>
}
