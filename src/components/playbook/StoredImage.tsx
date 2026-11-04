/**
 * An image from `/api/images`, or a placeholder saying why it is not there.
 *
 * A failed `<img>` does not reveal its status, so the URL is asked once more to
 * learn it: offline, signed out, gone or storage down read differently and are
 * fixed differently. An image that failed before hydration never fires `onError`,
 * and that is the usual case for a page served from the offline copy, so mounting
 * checks as well. It tries again when the connection returns.
 */
import { useEffect, useRef, useState } from 'react'
import styles from './Images.module.scss'
import { cx } from '~/lib/cx'
import { imageFailureMessage } from '~/lib/playbook/images'

async function whyFailed(src: string): Promise<string> {
  try {
    const response = await fetch(src)
    void response.body?.cancel()
    return imageFailureMessage(response.status)
  } catch {
    return imageFailureMessage(null)
  }
}

export function StoredImage({
  src,
  alt,
  className,
  width,
  height,
  lazy = false,
}: {
  src: string
  alt: string
  className?: string
  width?: number | null
  height?: number | null
  lazy?: boolean
}) {
  const [failure, setFailure] = useState<string | null>(null)
  const image = useRef<HTMLImageElement>(null)

  const onError = () => {
    void whyFailed(src).then(setFailure)
  }

  useEffect(() => {
    const element = image.current
    if (element?.complete && element.naturalWidth === 0 && element.currentSrc !== '') {
      void whyFailed(element.currentSrc).then(setFailure)
    }
  }, [])

  useEffect(() => {
    const retry = () => {
      setFailure(null)
    }
    window.addEventListener('online', retry)
    return () => {
      window.removeEventListener('online', retry)
    }
  }, [])

  if (failure) {
    return (
      <span className={cx(styles.placeholder, className)} role="img" aria-label={failure}>
        {failure}
      </span>
    )
  }
  return (
    <img
      ref={image}
      src={src}
      alt={alt}
      className={className}
      width={width ?? undefined}
      height={height ?? undefined}
      loading={lazy ? 'lazy' : undefined}
      onError={onError}
    />
  )
}
