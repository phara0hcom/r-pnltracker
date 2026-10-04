import { useEffect, useRef } from 'react'
import styles from './PageHeader.module.scss'
import { setPageTitle, setTitleScrolledPast } from './pageTitle'
import { cx } from '~/lib/cx'

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

/**
 * Screen title, a line of context under it, and slots for screen-level controls.
 *
 * `filter` is the control that decides which figures the screen shows — the
 * account switch. It sits with the actions on desktop and takes a row of its
 * own under the title on a phone, where hiding it behind a button left no way
 * to tell which accounts the figures on screen covered.
 */
export function PageHeader({
  title,
  meta,
  filter,
  actionsBeside = false,
  children,
}: {
  title: string
  meta?: React.ReactNode
  filter?: React.ReactNode
  /**
   * Keep the actions beside the title on a phone rather than on a row of
   * their own — for a single small button, which would otherwise sit alone
   * between the title and the filter.
   */
  actionsBeside?: boolean
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
    <header className={cx(styles.header, actionsBeside && styles.actionsBeside)}>
      <div className={styles.heading}>
        <h1 ref={heading} className={styles.title}>
          {title}
        </h1>
        {meta ? <p className={styles.meta}>{meta}</p> : null}
      </div>
      {filter ? <div className={styles.filter}>{filter}</div> : null}
      {children ? <div className={styles.actions}>{children}</div> : null}
    </header>
  )
}
