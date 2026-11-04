/**
 * The Charts section of a position: add, label, view and delete its screenshots.
 *
 * An image failing to load is its own slot's business, so nothing here can take
 * the rest of the page down with it. Archiving keeps the images and only stops
 * them being changed.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { holdForUpload, takeUnseenUploads, type HeldImage } from './heldImages'
import { HeldUploads } from './HeldUploads'
import { ImageDrop, ImagesNotConfigured } from './ImageDrop'
import { ImageFields, PhaseSelect, type ImageFieldValues } from './ImageFields'
import { ImageGallery } from './ImageGallery'
import styles from './Images.module.scss'
import { usePlaybookAction } from './usePlaybookAction'
import { Empty, Section } from '~/components/screen'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import type { GalleryImage } from '~/lib/playbook/images'
import type { ImagePhase } from '~/lib/playbook/types'
import { deleteImage, updateImage, type ActionResult } from '~/server/playbook'

function ImageActions({ image }: { image: GalleryImage }) {
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState<ImageFieldValues>({
    phase: image.phase,
    timeframe: image.timeframe ?? '',
    caption: image.caption,
  })
  const save = usePlaybookAction(
    (fields: ImageFieldValues): Promise<ActionResult> => updateImage({ data: { id: image.id, ...fields } }),
    () => {
      setEditing(false)
    },
  )
  const remove = usePlaybookAction((id: string): Promise<ActionResult> => deleteImage({ data: { id } }))
  const problem = save.problem ?? remove.problem

  return (
    <>
      {editing ? (
        <form
          className={styles.editForm}
          onSubmit={(event) => {
            event.preventDefault()
            save.run(values)
          }}
        >
          <ImageFields value={values} onChange={setValues} />
          <div className={styles.cardActions}>
            <button type="submit" className={styles.button} disabled={save.pending}>
              {save.pending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setEditing(false)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.cardActions}>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              setValues({ phase: image.phase, timeframe: image.timeframe ?? '', caption: image.caption })
              setEditing(true)
            }}
          >
            Edit
          </button>
          <ConfirmButton
            size="small"
            disabled={remove.pending}
            title="Delete this image"
            onConfirm={() => {
              remove.run(image.id)
            }}
          >
            Delete
          </ConfirmButton>
        </div>
      )}
      {problem ? (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}
    </>
  )
}

export function PositionCharts({
  journalId,
  images,
  enabled,
  archived,
}: {
  journalId: string
  images: readonly GalleryImage[]
  enabled: boolean
  archived: boolean
}) {
  const queryClient = useQueryClient()
  const phaseLabel = useId()
  const [phase, setPhase] = useState<ImagePhase>('ENTRY')
  const onImages = (held: HeldImage[]) => {
    holdForUpload(journalId, held, () => queryClient.invalidateQueries({ queryKey: ['playbook', 'position', journalId] }))
  }

  useEffect(() => {
    if (takeUnseenUploads(journalId)) void queryClient.invalidateQueries({ queryKey: ['playbook', 'position', journalId] })
  }, [journalId, queryClient])

  return (
    <Section title="Charts">
      {archived ? null : enabled ? (
        <div className={styles.adding}>
          <div className={styles.addingPhase}>
            <span id={phaseLabel} className={styles.muted}>
              New images go under
            </span>
            <PhaseSelect value={phase} labelledBy={phaseLabel} onChange={setPhase} />
          </div>
          <ImageDrop phase={phase} onImages={onImages} />
        </div>
      ) : (
        <ImagesNotConfigured />
      )}
      <HeldUploads journalId={journalId} />
      {images.length > 0 ? (
        <ImageGallery
          images={images}
          actions={archived ? undefined : (image) => <ImageActions key={image.id} image={image} />}
        />
      ) : (
        <Empty>No charts yet.</Empty>
      )}
    </Section>
  )
}
