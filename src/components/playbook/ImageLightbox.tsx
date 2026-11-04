/**
 * One image at full size, as a layer over the page that opened it.
 *
 * Not a page of its own: closing it, by Escape, ✕ or the browser's Back
 * (`useDialogHistory`), returns to wherever it was opened, and the URL never
 * changes. Arrow keys and a swipe move between the images it was given; the
 * buttons do the same for anyone who can use neither.
 */
import * as Dialog from '@radix-ui/react-dialog'
import styles from './Images.module.scss'
import { StoredImage } from './StoredImage'
import { useDialogHistory } from '~/components/ui/useDialogHistory'
import { useSwipe } from '~/components/ui/useSwipe'
import { PHASE_LABEL, type GalleryImage } from '~/lib/playbook/images'

export const describeImage = (image: Pick<GalleryImage, 'phase' | 'timeframe'>): string =>
  [PHASE_LABEL[image.phase], image.timeframe].filter(Boolean).join(' · ')

export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: readonly GalleryImage[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  useDialogHistory(true, onClose)
  const image = images[index]
  const hasPrevious = index > 0
  const hasNext = index < images.length - 1
  const previous = () => {
    if (hasPrevious) onIndexChange(index - 1)
  }
  const next = () => {
    if (hasNext) onIndexChange(index + 1)
  }
  const swipe = useSwipe({ onLeft: next, onRight: previous })
  if (!image) return null

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.lightboxOverlay} />
        <Dialog.Content
          className={styles.lightbox}
          aria-describedby={undefined}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') previous()
            if (event.key === 'ArrowRight') next()
          }}
        >
          <div className={styles.lightboxBar}>
            <Dialog.Title className={styles.lightboxTitle}>{describeImage(image)}</Dialog.Title>
            <span className={styles.muted}>
              {index + 1} of {images.length}
            </span>
            <Dialog.Close className={styles.button} aria-label="Close">
              ✕
            </Dialog.Close>
          </div>
          <div className={styles.lightboxStage} {...swipe}>
            {/* Keyed so a failure on one image does not carry over to the next. */}
            <StoredImage
              key={image.id}
              src={image.url}
              alt={image.caption || describeImage(image)}
              className={styles.lightboxImage}
              width={image.width}
              height={image.height}
            />
          </div>
          {image.caption ? <p className={styles.lightboxCaption}>{image.caption}</p> : null}
          {images.length > 1 ? (
            <div className={styles.lightboxNav}>
              <button type="button" className={styles.button} disabled={!hasPrevious} onClick={previous}>
                ← Previous
              </button>
              <button type="button" className={styles.button} disabled={!hasNext} onClick={next}>
                Next →
              </button>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
