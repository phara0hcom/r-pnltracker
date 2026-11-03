import { describe, expect, it } from 'vitest'
import { messageOf, validationMessage } from './usePlaybookAction'

describe('validationMessage', () => {
  it('recognises a validator’s rejection, which is not reported', () => {
    const error = new Error(JSON.stringify([{ message: 'target multiple must be between 1.0 and 3.0' }]))
    expect(validationMessage(error)).toBe('target multiple must be between 1.0 and 3.0')
  })

  it('is null for anything else, which is', () => {
    expect(validationMessage(new Error('Network down'))).toBeNull()
    expect(validationMessage(new Error('123'))).toBeNull()
    expect(validationMessage('nope')).toBeNull()
  })
})

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
