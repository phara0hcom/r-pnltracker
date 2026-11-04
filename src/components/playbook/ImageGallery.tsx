/**
 * Thumbnails that open a lightbox. Knows nothing about positions or editing, so
 * the setup pages can show their images with it: `actions` adds controls under
 * each image, and `grouped={false}` drops the phase headings.
 *
 * The lightbox is held by id, not index, so an image deleted from under it closes
 * it rather than sliding the next one into its place.
 */
import { useState } from 'react'
import { describeImage, ImageLightbox } from './ImageLightbox'
import styles from './Images.module.scss'
import { StoredImage } from './StoredImage'
import { groupByPhase, PHASE_LABEL, type GalleryImage } from '~/lib/playbook/images'

export function ImageGallery({
  images,
  grouped = true,
  actions,
}: {
  images: readonly GalleryImage[]
  grouped?: boolean
  actions?: (image: GalleryImage) => React.ReactNode
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const groups = grouped ? groupByPhase(images) : [{ phase: null, images: [...images] }]
  // The lightbox walks them in the order they are shown.
  const ordered = groups.flatMap((group) => group.images)
  const openIndex = ordered.findIndex((image) => image.id === openId)

  return (
    <div className={styles.gallery}>
      {groups.map((group) => (
        <div key={group.phase ?? 'all'}>
          {group.phase ? <h3 className={styles.groupTitle}>{PHASE_LABEL[group.phase]}</h3> : null}
          <ul className={styles.grid}>
            {group.images.map((image) => (
              <li key={image.id} className={styles.card}>
                <button
                  type="button"
                  className={styles.thumbButton}
                  aria-label={`Open ${describeImage(image)} chart${image.caption ? `: ${image.caption}` : ''}`}
                  onClick={() => {
                    setOpenId(image.id)
                  }}
                >
                  <StoredImage src={image.thumbUrl} alt="" className={styles.thumb} lazy />
                  {image.timeframe ? <span className={styles.timeframe}>{image.timeframe}</span> : null}
                </button>
                {image.caption ? <p className={styles.caption}>{image.caption}</p> : null}
                {actions?.(image)}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {openIndex >= 0 ? (
        <ImageLightbox
          images={ordered}
          index={openIndex}
          onIndexChange={(index) => {
            setOpenId(ordered[index]?.id ?? null)
          }}
          onClose={() => {
            setOpenId(null)
          }}
        />
      ) : null}
    </div>
  )
}
