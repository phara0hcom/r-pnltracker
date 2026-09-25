import { describe, expect, it } from 'vitest'
import type { ExitAction } from '../exit/types'
import { actionChanged, exitActionPushPayload, parseExitPushPayload } from './exitActionNotice'

const STOPPED_OUT: ExitAction = {
  kind: 'STOPPED_OUT',
  message: 'Stopped out — close $150.20 is at or below the $152.00 stop. Exit the remaining 100 shares.',
  severity: 'urgent',
}

describe('actionChanged', () => {
  it('is false with no prior observation, however different the current kind', () => {
    // A brand-new plan's first-ever evaluation, or a plan that predates this
    // feature — either way, nothing to compare against, so it seeds silently.
    expect(actionChanged(null, 'STOPPED_OUT')).toBe(false)
  })

  it('is false when the action kind is unchanged', () => {
    expect(actionChanged('HOLD', 'HOLD')).toBe(false)
  })

  it('is true for a real transition, of any severity', () => {
    expect(actionChanged('HOLD', 'TAKE_PARTIAL')).toBe(true)
    expect(actionChanged('MOVE_TO_BREAKEVEN', 'TRAIL_ACTIVE')).toBe(true)
  })
})

describe('exitActionPushPayload', () => {
  it('carries the symbol and the engine\'s own message verbatim', () => {
    const payload = exitActionPushPayload('rule-1', 'AAPL', STOPPED_OUT)
    expect(payload.title).toBe('AAPL')
    expect(payload.body).toBe(STOPPED_OUT.message)
    expect(payload.tag).toBe('exit:rule-1')
    expect(payload.data).toEqual({ ruleId: 'rule-1', actionKind: 'STOPPED_OUT', url: '/exits' })
  })

  it('tags by rule id, so a same-plan re-delivery replaces rather than stacks', () => {
    const first = exitActionPushPayload('rule-1', 'AAPL', STOPPED_OUT)
    const second = exitActionPushPayload('rule-2', 'AAPL', STOPPED_OUT)
    expect(first.tag).not.toBe(second.tag)
  })
})

describe('parseExitPushPayload', () => {
  it('round-trips a well-formed payload through JSON', () => {
    const payload = exitActionPushPayload('rule-1', 'AAPL', STOPPED_OUT)
    expect(parseExitPushPayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload)
  })

  it.each([
    null,
    undefined,
    'a string',
    42,
    {},
    { title: 'AAPL' },
    { title: 'AAPL', body: 'x', tag: 'exit:1', data: null },
    { title: 'AAPL', body: 'x', tag: 'exit:1', data: { ruleId: 1, actionKind: 'HOLD', url: '/exits' } },
  ])('rejects malformed input %#', (input) => {
    expect(parseExitPushPayload(input)).toBeNull()
  })
})
