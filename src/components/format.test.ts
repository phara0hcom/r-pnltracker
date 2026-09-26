/**
 * Display formatting, pinned where getting it wrong is invisible.
 *
 * These functions are the last step before a number reaches the screen, so a
 * mistake here does not throw, fail a type check or break a layout — it just
 * shows the wrong figure, correctly formatted, and is believed.
 */
import { describe, expect, it } from 'vitest'
import { dollarsCompact, money, moneySigned, pctSigned, tone, yen, yenCompact, yenSigned } from './format'

describe('money', () => {
  it('groups dollars, exactly as lib/exit/rules.ts does', () => {
    // The Exit Rules card renders the recommendation formatted by that module
    // directly above figures formatted by this one, so a US position showed the
    // same number written both ways an inch apart. Both must produce
    // `$1,500.00`; if `money` in rules.ts changes, this has to change with it.
    expect(money(1500, 'USD')).toBe('$1,500.00')
    expect(money(-15000, 'USD')).toBe('−$15,000.00')
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

  it('puts the minus sign before the currency symbol', () => {
    // The same on every screen, through these functions — one card reading
    // `−¥84,000` while the rest read `¥-84,000` is worse than either. U+2212,
    // not a hyphen, so it lines up with the plus in tabular figures.
    expect(moneySigned(-84000, 'JPY')).toBe('−¥84,000')
    expect(moneySigned(-15000, 'USD')).toBe('−$15,000.00')
    expect(yenSigned(-84000)).toBe('−¥84,000')
    expect(yen(-84000)).toBe('−¥84,000')
  })

  it('drops a sign the rounding took away', () => {
    expect(yenSigned(-0.4)).toBe('¥0')
    expect(yenSigned(0.4)).toBe('¥0')
    expect(moneySigned(-0.004, 'USD')).toBe('$0.00')
    expect(yenSigned(-0.5)).toBe('−¥1')
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

describe('pctSigned', () => {
  it('signs a return both ways', () => {
    expect(pctSigned(0.051)).toBe('+5.1%')
    expect(pctSigned(-0.0331)).toBe('−3.3%')
    expect(pctSigned(0)).toBe('0.0%')
    expect(pctSigned(null)).toBe('—')
  })
})

describe('yenCompact', () => {
  it('shortens for a label, keeping a decimal below ten thousand', () => {
    expect(yenCompact(93807)).toBe('+¥94k')
    expect(yenCompact(-56316)).toBe('−¥56k')
    expect(yenCompact(7400)).toBe('+¥7.4k')
    expect(yenCompact(1558843)).toBe('+¥1.56M')
    expect(yenCompact(640)).toBe('+¥640')
    expect(yenCompact(100000, false)).toBe('¥100k')
  })

  it('has a dollar twin', () => {
    expect(dollarsCompact(-346)).toBe('−$346')
    expect(dollarsCompact(1250)).toBe('+$1.3k')
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
