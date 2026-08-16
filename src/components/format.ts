/**
 * Display formatting.
 *
 * Values arrive as exact decimal strings. These functions are for *rendering
 * only* — nothing here feeds back into a calculation, so `Number()` is safe.
 */
export const yen = (value: string | number | null | undefined): string =>
  value == null ? '—' : '¥' + Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })

export const yenSigned = (value: string | number | null | undefined): string => {
  if (value == null) return '—'
  const asNumber = Number(value)
  return (asNumber > 0 ? '+' : '') + '¥' + asNumber.toLocaleString('en-US', { maximumFractionDigits: 0 })
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

export const ASSET_LABEL: Record<string, string> = {
  JP_EQUITY: 'JP equity',
  US_EQUITY: 'US equity',
  FUND: 'Fund',
}
