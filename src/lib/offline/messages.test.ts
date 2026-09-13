import { describe, expect, it } from 'vitest'
import {
  isNetworkFailure,
  isSavedCopyMessage,
  SAVED_PAGE_AGE_MS,
  savedAtLabel,
  savedPageTime,
} from './messages'

describe('isNetworkFailure', () => {
  it('recognises a lost connection in every engine', () => {
    for (const message of [
      'Failed to fetch',
      'Load failed',
      'NetworkError when attempting to fetch resource.',
    ]) {
      expect(isNetworkFailure(new TypeError(message))).toBe(true)
    }
  })

  it('does not blame the network for a bug or a server error', () => {
    expect(isNetworkFailure(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false)
    expect(isNetworkFailure(new Error('unknown instrument 8411'))).toBe(false)
    expect(isNetworkFailure('Failed to fetch')).toBe(false)
  })
})

describe('isSavedCopyMessage', () => {
  it('accepts the worker’s message', () => {
    expect(isSavedCopyMessage({ type: 'pnl:saved-copy', savedAt: 1_789_000_000_000 })).toBe(true)
  })

  it('rejects anything else a page can be sent', () => {
    for (const data of [
      null,
      'pnl:saved-copy',
      { type: 'pnl:saved-copy' },
      { type: 'pnl:saved-copy', savedAt: '1789000000000' },
      { type: 'pnl:saved-copy', savedAt: Number.NaN },
      { type: 'something-else', savedAt: 1 },
    ]) {
      expect(isSavedCopyMessage(data)).toBe(false)
    }
  })
})

describe('savedPageTime', () => {
  const renderedAt = 1_789_000_000_000

  it('treats a page that arrived within seconds of rendering as live', () => {
    expect(savedPageTime(renderedAt, renderedAt + 3_000)).toBeNull()
    expect(savedPageTime(renderedAt, renderedAt + SAVED_PAGE_AGE_MS)).toBeNull()
  })

  it('treats an older page as a saved copy, saved when it was rendered', () => {
    expect(savedPageTime(renderedAt, renderedAt + SAVED_PAGE_AGE_MS + 1)).toBe(renderedAt)
    expect(savedPageTime(renderedAt, renderedAt + 86_400_000)).toBe(renderedAt)
  })

  it('treats a render "from the future" as live, as a phone clock running slow would show it', () => {
    expect(savedPageTime(renderedAt, renderedAt - 60_000)).toBeNull()
  })
})

describe('savedAtLabel', () => {
  it('reads as day, month, and a 24-hour time', () => {
    expect(savedAtLabel(new Date(2026, 8, 13, 14, 2))).toBe('13 Sep, 14:02')
  })

  it('pads the time but not the day', () => {
    expect(savedAtLabel(new Date(2026, 0, 5, 9, 7))).toBe('5 Jan, 09:07')
  })
})
