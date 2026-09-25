import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DayOrderList, type DayOrderItem } from './DayOrderList'

const items: DayOrderItem[] = [
  { id: 'b29', symbol: 'SOXL', accountType: 'SPECIFIC', side: 'BUY', quantity: '29', price: '$142.1166' },
  { id: 'b2', symbol: 'SOXL', accountType: 'SPECIFIC', side: 'BUY', quantity: '2', price: '$144.94' },
  { id: 's20', symbol: 'SOXL', accountType: 'SPECIFIC', side: 'SELL', quantity: '20', price: '$146.0497' },
]

describe('DayOrderList', () => {
  it('moves a trade earlier by button, which works without a pointer', () => {
    let next: DayOrderItem[] = items
    render(
      <DayOrderList
        items={items}
        label="Order"
        onChange={(order) => {
          next = order
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Move SELL 20 SOXL earlier' }))
    expect(next.map((item) => item.id)).toEqual(['b29', 's20', 'b2'])
  })

  it('cannot move the first trade earlier or the last one later', () => {
    render(<DayOrderList items={items} label="Order" onChange={() => undefined} />)
    const disabled = (name: string) => screen.getByRole('button', { name }).hasAttribute('disabled')
    expect(disabled('Move BUY 29 SOXL earlier')).toBe(true)
    expect(disabled('Move SELL 20 SOXL later')).toBe(true)
    expect(disabled('Move BUY 2 SOXL earlier')).toBe(false)
  })
})
