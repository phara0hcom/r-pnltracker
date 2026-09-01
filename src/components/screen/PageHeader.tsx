import { useEffect, useRef } from 'react'
import styles from './PageHeader.module.scss'
import { setPageTitle, setTitleScrolledPast } from './pageTitle'

/** Fallback if the token is unreadable — matches `--topbar-height`. */
const TOPBAR_FALLBACK_PX = 60

/**
 * How far down the viewport the SP header reaches.
 *
 * Read from the token rather than repeated as a constant, so the point at which
 * the title counts as hidden cannot drift from the bar that hides it.
 */
function topBarHeight(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--topbar-height')
  return Number.parseFloat(raw) || TOPBAR_FALLBACK_PX
}

/** Screen title, a line of context under it, and a slot for screen-level controls. */
export function PageHeader({
  title,
  meta,
  children,
}: {
  title: string
  meta?: React.ReactNode
  children?: React.ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    setPageTitle(title)
    const element = heading.current
    if (!element) return

    /*
     * The top margin is negative by the header's height, which shrinks the
     * observed area to the part of the viewport the header does not cover. The
     * title therefore stops intersecting the moment it slides under the bar,
     * rather than when it leaves the screen entirely — otherwise there is a
     * header's worth of scrolling where the title is invisible but the brand is
     * still showing.
     */
    const observer = new IntersectionObserver(
      ([entry]) => {
        setTitleScrolledPast(entry != null && !entry.isIntersecting)
      },
      { rootMargin: `-${String(topBarHeight())}px 0px 0px 0px` },
    )
    observer.observe(element)

    return () => {
      observer.disconnect()
      // Cleared on the way out so a screen without a PageHeader — or a route
      // mid-transition — cannot leave the previous page's name in the bar.
      setPageTitle(null)
    }
  }, [title])

  return (
    <header className={styles.header}>
      <div>
        <h1 ref={heading} className={styles.title}>
          {title}
        </h1>
        {meta ? <p className={styles.meta}>{meta}</p> : null}
      </div>
      {children ? <div className={styles.actions}>{children}</div> : null}
    </header>
  )
}
