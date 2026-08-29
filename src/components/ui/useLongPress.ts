/**
 * Press-and-hold, for touch.
 *
 * The awkward part is not the timer — it is that the press ends in a `click`
 * the browser still delivers. On an element that is also a link, that click
 * navigates away the instant the user lets go, so it has to be swallowed once.
 *
 * Movement cancels: a hold that turns into a scroll is a scroll, and firing
 * mid-flick would fight the page.
 */
import { useCallback, useRef } from 'react'

const HOLD_MS = 500
/** Past this the finger is scrolling, not holding. */
const SLOP_PX = 10

export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  /*
   * Set when the press fires, cleared by the click it swallows — and again at
   * the start of the next press.
   *
   * That reset is the important one: some browsers suppress the click after a
   * long press entirely, and without it the flag would survive to swallow the
   * user's next ordinary tap instead. A ref rather than state because nothing
   * renders from it.
   */
  const fired = useRef(false)

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Scoped to this gesture, so a swallowed click can never leak into the next.
      fired.current = false
      // Mouse users have hover and the `title`; a held left button should not
      // silently become a different gesture.
      if (event.pointerType === 'mouse') return
      origin.current = { x: event.clientX, y: event.clientY }
      timer.current = setTimeout(() => {
        fired.current = true
        onLongPress()
      }, HOLD_MS)
    },
    [onLongPress],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const start = origin.current
      if (!start) return
      if (Math.abs(event.clientX - start.x) > SLOP_PX || Math.abs(event.clientY - start.y) > SLOP_PX) {
        cancel()
      }
    },
    [cancel],
  )

  const onClick = useCallback((event: React.MouseEvent) => {
    if (!fired.current) return
    // The click that ends the hold. Swallow exactly one, then behave normally.
    event.preventDefault()
    event.stopPropagation()
    fired.current = false
  }, [])

  return {
    /** Spread onto the element that should respond to a hold. */
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onClick,
      // iOS raises its own selection callout on a long press, which lands on
      // top of whatever the hold opened.
      onContextMenu: (event: React.MouseEvent) => {
        if (origin.current || fired.current) event.preventDefault()
      },
    },
  }
}
