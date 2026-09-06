/**
 * The clamp, which only matters in the cases it exists for.
 *
 * The ladder places two marks between the initial stop and Target 1. Both of
 * those bounds can be crossed — that is what a stop and a target are — and the
 * moment either is, the fraction leaves 0–1 while the plan still has to render.
 * Un-clamped, a stopped-out position draws its marker outside the track, which
 * is precisely the position whose card you most need to read.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExitLadder } from './ExitLadder'
import { makePlan } from '~/test/exitPlan'

/** `[stop, now]` as percentage strings, in the order the marks are rendered. */
function marks(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('span[style]')].map((el) => el.style.left)
}

/** A clean 100-wide axis, so every expected percentage is readable by eye. */
const axis = { initialStop: '100', target1: '200', currentStop: '100' }

describe('ExitLadder', () => {
  it('places both marks proportionally between the stop and the target', () => {
    const { container } = render(
      <ExitLadder row={makePlan({ ...axis, currentPrice: '150' })} />,
    )
    expect(marks(container)).toEqual(['0%', '50%'])
  })

  it('follows the effective stop up as the trail ratchets', () => {
    const { container } = render(
      <ExitLadder row={makePlan({ ...axis, currentStop: '175', currentPrice: '190' })} />,
    )
    expect(marks(container)).toEqual(['75%', '90%'])
  })

  it('holds a price through the stop at the left edge', () => {
    // Below the initial stop the fraction goes negative. This is the stopped-out
    // card — the one the whole screen is sorted to surface.
    const { container } = render(
      <ExitLadder row={makePlan({ ...axis, currentPrice: '40' })} />,
    )
    expect(marks(container)).toEqual(['0%', '0%'])
  })

  it('holds a price past Target 1 at the right edge', () => {
    const { container } = render(
      <ExitLadder row={makePlan({ ...axis, currentPrice: '260' })} />,
    )
    expect(marks(container)).toEqual(['0%', '100%'])
  })

  it('draws nothing when there is no last close', () => {
    // An empty track reads as a plan with no room left. A missing one reads as
    // what it is — no data — and the figures beside it say so in words.
    const { container } = render(<ExitLadder row={makePlan({ currentPrice: null })} />)
    expect(container.firstChild).toBeNull()
  })

  it('draws nothing when the target is not above the stop', () => {
    // A zero or inverted range divides by zero. Reachable through a mistyped
    // support level, which the edit dialog exists to let you correct.
    const { container } = render(
      <ExitLadder row={makePlan({ initialStop: '200', target1: '200', currentPrice: '200' })} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('labels the two ends in the instrument’s own currency', () => {
    const { getByText } = render(
      <ExitLadder row={makePlan({ ...axis, currentPrice: '150', currency: 'USD' })} ends />,
    )
    expect(getByText('$100.00')).toBeTruthy()
    expect(getByText('$200.00')).toBeTruthy()
  })

  it('is hidden from screen readers, since every value is written out beside it', () => {
    const { container } = render(
      <ExitLadder row={makePlan({ ...axis, currentPrice: '150' })} />,
    )
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })
})
