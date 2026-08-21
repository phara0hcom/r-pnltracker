/**
 * The Trades screen's URL search params.
 *
 * Filter, sort and paging state lives in the URL rather than component state,
 * so a view is shareable and survives a refresh. The schema sits in `lib` so the
 * route and the filter and pagination components can all read the same types
 * without importing each other.
 */
import { z } from 'zod'

export const ACCOUNTS = ['SPECIFIC', 'NISA_OLD', 'NISA_GROWTH', 'NISA_TSUMITATE'] as const
export const CLASSES = ['JP_EQUITY', 'US_EQUITY', 'FUND'] as const
export const SIDES = ['BUY', 'SELL', 'REINVEST', 'REDEEM'] as const
export const SORTABLE = [
  'tradeDate',
  'settleDate',
  'symbol',
  'quantity',
  'displayPrice',
  'netAmountJpy',
  'realizedJpy',
  'returnPct',
] as const

export const PER_PAGE_OPTIONS = [25, 50, 100, 250] as const

/**
 * `.catch()` on every field is deliberate: a stale bookmark or hand-edited URL
 * should fall back to the default view, never blow up the route.
 */
export const tradeSearchSchema = z.object({
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  account: z.enum(ACCOUNTS).optional().catch(undefined),
  assetClass: z.enum(CLASSES).optional().catch(undefined),
  side: z.enum(SIDES).optional().catch(undefined),
  symbol: z.string().optional().catch(undefined),
  outcome: z.enum(['win', 'loss']).optional().catch(undefined),
  sortBy: z.enum(SORTABLE).catch('tradeDate'),
  sortDir: z.enum(['asc', 'desc']).catch('desc'),
  // Paging lives in the URL like the filters, so a link points at the same page.
  page: z.number().int().min(1).catch(1).optional(),
  perPage: z.union([z.literal(25), z.literal(50), z.literal(100), z.literal(250)])
    .catch(50)
    .optional(),
  // The sidebar's All/NISA/特定 switch. This screen keeps its own richer
  // four-way `account` filter and does not apply `scope`, but must carry it:
  // a zod object strips unknown keys, so passing through Trades would otherwise
  // silently discard the switch and it could not come back.
  scope: z.enum(['ALL', 'NISA', 'SPECIFIC']).catch('ALL').optional(),
})

export type TradeSearch = z.infer<typeof tradeSearchSchema>
export type PerPage = NonNullable<TradeSearch['perPage']>
export type TradeSortKey = (typeof SORTABLE)[number]
