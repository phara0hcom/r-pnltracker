/**
 * Display formatting, pinned where getting it wrong is invisible.
 *
 * These functions are the last step before a number reaches the screen, so a
 * mistake here does not throw, fail a type check or break a layout — it just
 * shows the wrong figure, correctly formatted, and is believed.
 */
import { describe, expect, it } from 'vitest'
import { money, moneySigned, tone, yen, yenSigned } from './format'

describe('money', () => {
  it('groups dollars, exactly as lib/exit/rules.ts does', () => {
    // The Exit Rules card renders the recommendation formatted by that module
    // directly above figures formatted by this one, so a US position showed the
    // same number written both ways an inch apart. Both must produce
    // `$1,500.00`; if `money` in rules.ts changes, this has to change with it.
    expect(money(1500, 'USD')).toBe('$1,500.00')
    expect(money(-15000, 'USD')).toBe('$-15,000.00')
  })

  it('keeps two decimals on dollars, whatever the input has', () => {
    expect(money(214.3, 'USD')).toBe('$214.30')
    expect(money(214, 'USD')).toBe('$214.00')
  })

  it('rounds yen to whole units, because sub-yen prices do not exist', () => {
    expect(money(2684, 'JPY')).toBe('¥2,684')
    expect(money(2684.7, 'JPY')).toBe('¥2,685')
  })

  it('accepts the exact decimal strings the server actually sends', () => {
    // Every figure arrives as a string from `numeric(24,8)`, never a number.
    expect(money('2684.00000000', 'JPY')).toBe('¥2,684')
    expect(money('214.30000000', 'USD')).toBe('$214.30')
  })

  it('renders an em dash for an absent price rather than 0 or NaN', () => {
    expect(money(null, 'USD')).toBe('—')
    expect(money(undefined, 'JPY')).toBe('—')
  })
})

describe('moneySigned', () => {
  it('adds the plus that Number never prints', () => {
    expect(moneySigned(84000, 'JPY')).toBe('+¥84,000')
    expect(moneySigned(1500, 'USD')).toBe('+$1,500.00')
  })

  it('leaves the minus where the currency symbol puts it', () => {
    // Inside the symbol, matching `yenSigned` — the app has printed losses this
    // way on every screen since before this function existed, and one card
    // reading `−¥84,000` while the rest read `¥-84,000` is worse than either.
    expect(moneySigned(-84000, 'JPY')).toBe('¥-84,000')
    expect(moneySigned(-15000, 'USD')).toBe('$-15,000.00')
  })

  it('does not sign zero, which has no direction', () => {
    expect(moneySigned(0, 'JPY')).toBe('¥0')
  })

  it('renders an em dash for an absent figure', () => {
    expect(moneySigned(null, 'JPY')).toBe('—')
  })
})

describe('yen', () => {
  it('groups thousands', () => {
    expect(yen(1234567)).toBe('¥1,234,567')
    expect(yenSigned(500)).toBe('+¥500')
  })
})

describe('tone', () => {
  it('reads a figure as profit, loss or neither', () => {
    expect(tone(1)).toBe('profit')
    expect(tone(-1)).toBe('loss')
    expect(tone(0)).toBe('flat')
  })

  it('treats a missing figure as flat, not as a loss', () => {
    // An unpriced position is not a losing one, and colouring it red says so.
    expect(tone(null)).toBe('flat')
    expect(tone(undefined)).toBe('flat')
  })
})
