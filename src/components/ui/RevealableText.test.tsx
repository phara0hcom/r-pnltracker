/**
 * Long press is three rules, and each one is a thing that goes wrong:
 *
 * - a quick tap must not open it, or the reveal fires on ordinary taps;
 * - a press that turns into a scroll must not open it, or it fights the page;
 * - the click that ends a real hold must be swallowed, or the link under it
 *   navigates the moment you let go.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevealableText } from './RevealableText'

const NAME = '野村インデックスファンド・外国株式・為替ヘッジ型'
const HOLD_MS = 500

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** jsdom does not construct PointerEvent, so the type is carried explicitly. */
const press = (el: Element, over: Record<string, unknown> = {}) =>
  fireEvent.pointerDown(el, { pointerType: 'touch', clientX: 10, clientY: 10, ...over })

const target = () => screen.getByTitle(NAME)

function renderText() {
  return render(<RevealableText text={NAME} className="name" />)
}

/** Radix portals its content; the popover is found by searching the document. */
const popoverShowing = () =>
  [...document.querySelectorAll('[data-radix-popper-content-wrapper]')].length > 0

describe('RevealableText', () => {
  it('renders the text with a title, so pointer users get it on hover', () => {
    renderText()
    expect(target().textContent).toBe(NAME)
  })

  it('does not open on a quick tap', () => {
    renderText()
    press(target())
    act(() => {
      vi.advanceTimersByTime(HOLD_MS - 100)
    })
    fireEvent.pointerUp(target())
    expect(popoverShowing()).toBe(false)
  })

  it('opens on a real hold', () => {
    renderText()
    press(target())
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 50)
    })
    expect(popoverShowing()).toBe(true)
  })

  it('does not open when the press turns into a scroll', () => {
    renderText()
    const el = target()
    press(el)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    // Past the slop threshold — this is a scroll, not a hold.
    fireEvent.pointerMove(el, { pointerType: 'touch', clientX: 10, clientY: 60 })
    act(() => {
      vi.advanceTimersByTime(HOLD_MS)
    })
    expect(popoverShowing()).toBe(false)
  })

  it('swallows the click that ends a hold, then behaves normally', () => {
    renderText()
    const el = target()

    press(el)
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 50)
    })
    fireEvent.pointerUp(el)
    // The browser still delivers this; unswallowed it would follow the link.
    expect(fireEvent.click(el)).toBe(false)

    // Exactly one is eaten — the next ordinary tap must go through, even
    // though some browsers suppress the post-long-press click entirely.
    press(el)
    fireEvent.pointerUp(el)
    expect(fireEvent.click(el)).toBe(true)
  })

  it('ignores a mouse press, which has hover and the title instead', () => {
    renderText()
    press(target(), { pointerType: 'mouse' })
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 50)
    })
    expect(popoverShowing()).toBe(false)
  })
})
