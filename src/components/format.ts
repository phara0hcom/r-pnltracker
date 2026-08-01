/**
 * Display formatting.
 *
 * Values arrive as exact decimal strings. These functions are for *rendering
 * only* — nothing here feeds back into a calculation, so `Number()` is safe.
 */
export const yen = (v: string | number | null | undefined): string =>
  v == null ? '—' : '¥' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })

export const yenSigned = (v: string | number | null | undefined): string => {
  if (v == null) return '—'
  const n = Number(v)
  return (n > 0 ? '+' : '') + '¥' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export const pct = (v: number | null | undefined, digits = 1): string =>
  v == null ? '—' : (v * 100).toFixed(digits) + '%'

export const ratio = (v: number | null | undefined, digits = 2): string =>
  v == null ? '—' : v.toFixed(digits)

export const qty = (v: string | number): string =>
  Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 })

export const days = (v: number | null | undefined): string =>
  v == null ? '—' : Math.round(v).toLocaleString('en-US') + 'd'

export const tone = (v: string | number | null | undefined): 'profit' | 'loss' | 'flat' => {
  if (v == null) return 'flat'
  const n = Number(v)
  return n > 0 ? 'profit' : n < 0 ? 'loss' : 'flat'
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
