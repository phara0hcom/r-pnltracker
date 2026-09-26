/**
 * Display formatting.
 *
 * Values arrive as exact decimal strings. These functions are for *rendering
 * only* — nothing here feeds back into a calculation, so `Number()` is safe.
 *
 * A loss reads `−¥84,000`: the minus sign (U+2212, as wide as the plus in
 * tabular figures) before the currency symbol, on every screen. The symbol
 * used to come first — `¥-84,000` — because that is what `toLocaleString`
 * prints for a negative number, not because anyone chose it.
 */

/** The minus sign, not a hyphen. */
export const MINUS = '\u2212'

/**
 * `magnitude` is the absolute value already formatted; the sign goes on only if
 * it survived the rounding, so −0.4 reads `¥0` and not `−¥0`.
 */
const withSign = (value: number, magnitude: string, zero: string, plus: boolean): string =>
  magnitude === zero ? '' : value < 0 ? MINUS : plus && value > 0 ? '+' : ''

const yenDigits = (value: number) =>
  Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 })

const dollarDigits = (value: number) =>
  Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const yen = (value: string | number | null | undefined): string => {
  if (value == null) return '—'
  const asNumber = Number(value)
  const magnitude = yenDigits(asNumber)
  return withSign(asNumber, magnitude, '0', false) + '¥' + magnitude
}

export const yenSigned = (value: string | number | null | undefined): string => {
  if (value == null) return '—'
  const asNumber = Number(value)
  const magnitude = yenDigits(asNumber)
  return withSign(asNumber, magnitude, '0', true) + '¥' + magnitude
}

/**
 * A figure in its instrument's own currency.
 *
 * The currency argument is required on purpose: the Exit Rules card previously
 * hardcoded 'JPY' for one field and printed a US position's dollars with a yen
 * sign, which a default would have allowed again.
 *
 * Dollars are grouped for the same reason `money` in `lib/exit/rules.ts` groups
 * them — a bare `$10000.00` beside a `¥10,000` reads as a typo. The two have to
 * agree: an Exit Rules card prints the recommendation formatted by that one and
 * the figures under it by this one, so a US position showed the same number
 * written both ways an inch apart.
 */
export const money = (
  value: string | number | null | undefined,
  currency: 'JPY' | 'USD',
): string => {
  if (value == null) return '—'
  if (currency === 'JPY') return yen(value)
  const asNumber = Number(value)
  const magnitude = dollarDigits(asNumber)
  return withSign(asNumber, magnitude, '0.00', false) + '$' + magnitude
}

/**
 * `money` with an explicit sign, for figures that are read as a change.
 *
 * `Number` prints the minus but never the plus, and an unsigned gain beside a
 * signed loss reads as an amount rather than a direction.
 */
export const moneySigned = (
  value: string | number | null | undefined,
  currency: 'JPY' | 'USD',
): string => {
  if (value == null) return '—'
  if (currency === 'JPY') return yenSigned(value)
  const asNumber = Number(value)
  const magnitude = dollarDigits(asNumber)
  return withSign(asNumber, magnitude, '0.00', true) + '$' + magnitude
}

/**
 * A signed percentage, `+5.1%` or `−3.3%`. `pct` below stays unsigned for
 * shares of a whole; this is for returns.
 */
export const pctSigned = (value: number | null | undefined, digits = 1): string => {
  if (value == null) return '—'
  const magnitude = Math.abs(value * 100).toFixed(digits)
  return withSign(value, magnitude, (0).toFixed(digits), true) + magnitude + '%'
}

/**
 * Yen shortened for a chart label or a calendar square: `+¥94k`, `−¥1.24M`.
 * Full precision belongs in the tooltip or the row beside it.
 */
export const yenCompact = (value: string | number | null | undefined, signed = true): string => {
  if (value == null) return '—'
  const asNumber = Number(value)
  const abs = Math.abs(asNumber)
  const magnitude =
    abs >= 1_000_000
      ? `${(abs / 1_000_000).toFixed(2)}M`
      : abs >= 10_000
        ? `${Math.round(abs / 1_000).toString()}k`
        : abs >= 1_000
          ? `${(abs / 1_000).toFixed(1)}k`
          : Math.round(abs).toString()
  return withSign(asNumber, magnitude, '0', signed) + '¥' + magnitude
}

/** The dollar twin of `yenCompact`: whole dollars, thousands abbreviated. */
export const dollarsCompact = (value: string | number | null | undefined): string => {
  if (value == null) return '—'
  const asNumber = Number(value)
  const abs = Math.abs(asNumber)
  const magnitude = abs >= 1_000 ? `${(abs / 1_000).toFixed(1)}k` : abs.toFixed(0)
  return withSign(asNumber, magnitude, '0', true) + '$' + magnitude
}

export const pct = (value: number | null | undefined, digits = 1): string =>
  value == null ? '—' : (value * 100).toFixed(digits) + '%'

export const ratio = (value: number | null | undefined, digits = 2): string =>
  value == null ? '—' : value.toFixed(digits)

export const qty = (value: string | number): string =>
  Number(value).toLocaleString('en-US', { maximumFractionDigits: 4 })

export const days = (value: number | null | undefined): string =>
  value == null ? '—' : Math.round(value).toLocaleString('en-US') + 'd'

export const tone = (value: string | number | null | undefined): 'profit' | 'loss' | 'flat' => {
  if (value == null) return 'flat'
  const asNumber = Number(value)
  return asNumber > 0 ? 'profit' : asNumber < 0 ? 'loss' : 'flat'
}

export const ACCOUNT_LABEL: Record<string, string> = {
  SPECIFIC: '特定',
  NISA_GROWTH: 'NISA 成長',
  NISA_TSUMITATE: 'NISA つみたて',
  NISA_OLD: '旧NISA',
}

/** The account's full name, for a heading rather than a cell. */
export const ACCOUNT_TITLE: Record<string, string> = {
  SPECIFIC: '特定口座',
  NISA_GROWTH: 'NISA 成長投資枠',
  NISA_TSUMITATE: 'NISA つみたて投資枠',
  NISA_OLD: '旧NISA',
}

export const ASSET_LABEL: Record<string, string> = {
  JP_EQUITY: 'JP equity',
  US_EQUITY: 'US equity',
  FUND: 'Fund',
}

/** The class as a tag beside a symbol. */
export const ASSET_TAG: Record<string, string> = {
  JP_EQUITY: 'JP',
  US_EQUITY: 'US',
  FUND: 'Fund',
}
