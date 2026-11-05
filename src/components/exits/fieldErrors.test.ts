import { describe, expect, it } from 'vitest'
import { toFieldErrors } from './fieldErrors'

describe('toFieldErrors', () => {
  it('puts a validator rejection on its field, as a sentence', () => {
    const message = JSON.stringify([{ code: 'custom', path: ['targetMultiple'], message: 'must be between 1.0 and 3.0' }])
    expect(toFieldErrors(new Error(message))).toEqual({ targetMultiple: 'must be between 1.0 and 3.0' })
  })

  it('keeps an issue with no path on the form', () => {
    expect(toFieldErrors(new Error(JSON.stringify([{ path: [], message: 'No.' }])))).toEqual({ form: 'No.' })
  })

  it('shows any other error as it stands', () => {
    expect(toFieldErrors(new Error('The server is down'))).toEqual({ form: 'The server is down' })
    // JSON, but not a list of issues.
    expect(toFieldErrors(new Error('{"a":1}'))).toEqual({ form: '{"a":1}' })
  })

  it('survives a rejection that is not an Error', () => {
    expect(toFieldErrors('nope')).toEqual({ form: 'Could not save' })
    expect(toFieldErrors(null)).toEqual({ form: 'Could not save' })
  })
})
