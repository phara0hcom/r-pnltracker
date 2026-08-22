/**
 * The Positions screen's URL search params.
 *
 * Sort state lives in the URL rather than component state, like every other
 * filter here, so a sorted view is shareable and survives a refresh.
 *
 * Built on `accountScopeSchema` rather than beside it: a zod object strips
 * unknown keys, so a screen that declares its own params must still carry
 * `scope` or the All/NISA/特定 switch is discarded the moment you sort.
 */
import { z } from 'zod'
import { accountScopeSchema } from './accountScope'

/**
 * The columns, in the order the table renders them.
 *
 * Two keys are not row fields. `avgCost` and `price` are rendered from a
 * different field depending on currency, so the route supplies an accessor for
 * each; naming them after the column keeps the header and the ordering in step.
 */
export const POSITION_SORTABLE = [
  'symbol',
  'accountType',
  'assetClass',
  'quantity',
  'avgCost',
  'costBasisJpy',
  'price',
  'marketValueJpy',
  'unrealizedJpy',
  'unrealizedPct',
] as const

export type PositionSortKey = (typeof POSITION_SORTABLE)[number]

/**
 * `.catch()` on both fields, like every other search schema here: a stale
 * bookmark or a hand-edited URL falls back to the default view instead of
 * erroring the route.
 *
 * The default reproduces the server's own ordering — `getPositions` returns
 * rows by cost basis descending — so the screen looks untouched until the first
 * click rather than rearranging itself on arrival.
 */
export const positionSearchSchema = accountScopeSchema.extend({
  sortBy: z.enum(POSITION_SORTABLE).catch('costBasisJpy'),
  sortDir: z.enum(['asc', 'desc']).catch('desc'),
})

export type PositionSearch = z.infer<typeof positionSearchSchema>
