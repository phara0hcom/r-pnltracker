/**
 * A per-share price, for display only.
 *
 * `money` in `format.ts` rounds yen to the whole yen, which is right for an
 * amount and wrong for a price: 東証 quotes in tenths on many codes, and a
 * stop at ¥2,783.5 shown as ¥2,784 is a different stop.
 */
import { MINUS } from '~/components/format'
import type { Currency } from '~/lib/domain/types'

export function formatPrice(value: string | null, currency: Currency, compact = false): string {
  if (value === null) return '—'
  const asNumber = Number(value)
  const digits =
    currency === 'JPY'
      ? { minimumFractionDigits: 0, maximumFractionDigits: compact ? 0 : 1 }
      : { minimumFractionDigits: 2, maximumFractionDigits: compact ? 2 : 4 }
  const magnitude = Math.abs(asNumber).toLocaleString('en-US', digits)
  return (asNumber < 0 ? MINUS : '') + (currency === 'JPY' ? '¥' : '$') + magnitude
}
