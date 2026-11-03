import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RatingInput } from './RatingInput'

describe('RatingInput', () => {
  it('is a named group of ten radios', () => {
    render(<RatingInput label="Entry rating" value={null} onChange={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Entry rating' })).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(10)
  })

  it('reports the chosen value and marks it', () => {
    const onChange = vi.fn()
    render(<RatingInput label="Entry rating" value={7} onChange={onChange} />)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: '7' }).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: '9' }))
    expect(onChange).toHaveBeenCalledWith(9)
  })

  it('can be cleared once set, since unrated is its own value', () => {
    const onChange = vi.fn()
    const { rerender } = render(<RatingInput label="Entry rating" value={null} onChange={onChange} />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<RatingInput label="Entry rating" value={3} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
