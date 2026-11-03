import { describe, expect, it } from 'vitest'
import { messageOf } from './usePlaybookAction'

describe('messageOf', () => {
  it('shows the first issue of a validator’s rejection rather than its JSON', () => {
    const error = new Error(JSON.stringify([{ path: ['shares'], message: 'shares must be a positive number' }]))
    expect(messageOf(error)).toBe('shares must be a positive number')
  })

  it('shows anything else as it stands', () => {
    expect(messageOf(new Error('Network down'))).toBe('Network down')
    expect(messageOf('nope')).toBe('Could not save.')
  })
})
