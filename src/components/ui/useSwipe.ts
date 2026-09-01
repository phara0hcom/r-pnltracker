/**
 * Horizontal swipe over a touch surface.
 *
 * Touch-only, and deliberately additive: every surface using this also carries
 * real buttons for the same two actions. A gesture is invisible, unreachable by
 * keyboard and unannounced to a screen reader, so it can be the *fast* way to
 * page but never the only one.
 *
 * The caller must set `touch-action: pan-y` on the surface. Without it the
 * browser may claim the horizontal drag for its own scrolling before
 * `touchend` ever fires.
 */
import { useRef } from 'react'

/** Minimum horizontal travel before a drag counts as a swipe, in px. */
const THRESHOLD = 48

export interface SwipeHandlers {
  onTouchStart?: (event: React.TouchEvent) => void
  onTouchEnd?: (event: React.TouchEvent) => void
}

export function useSwipe({
  onLeft,
  onRight,
  enabled = true,
}: {
  /** Finger travelled left — by convention, reveal what comes *after*. */
  onLeft: () => void
  /** Finger travelled right — reveal what comes *before*. */
  onRight: () => void
  enabled?: boolean
}): SwipeHandlers {
  const origin = useRef<{ x: number; y: number } | null>(null)

  if (!enabled) return {}

  return {
    onTouchStart: (event) => {
      const touch = event.touches[0]
      // A second finger means a pinch-zoom, not a page: drop the gesture rather
      // than paging on whichever finger happens to lift first.
      origin.current =
        event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null
    },
    onTouchEnd: (event) => {
      const start = origin.current
      origin.current = null
      const touch = event.changedTouches[0]
      if (!start || !touch) return

      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      // Ignore anything that travelled further vertically than horizontally —
      // that is the reader scrolling the page past a chart, not paging it.
      if (Math.abs(dx) < THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return

      if (dx < 0) onLeft()
      else onRight()
    },
  }
}
