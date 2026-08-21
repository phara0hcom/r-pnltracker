import type { TradeRow } from '~/server/trades'

/**
 * Compact account labels for the trades table.
 *
 * Deliberately shorter than `components/format.ts`'s `ACCOUNT_LABEL`: this one
 * has to fit a 90px column badge, where "NISA つみたて" wraps.
 */
export const ACCOUNT_LABEL: Record<TradeRow['accountType'], string> = {
  SPECIFIC: '特定',
  NISA_GROWTH: 'N成長',
  NISA_TSUMITATE: 'Nつみたて',
  NISA_OLD: '旧NISA',
}
