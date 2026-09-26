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
 * Three keys are not row fields. `avgCost` and `price` are rendered from a
 * different field depending on currency, so the route supplies an accessor for
 * each; naming them after the column keeps the header and the ordering in step.
 * `weight` is each row's share of the book, which the server works out.
 *
 * There is no Account or Class column. The table is grouped by account, under
 * a header carrying the account's totals, and each instrument is tagged with
 * its class — a column repeating one of four values down every row said
 * nothing a heading could not say once.
 *
 * `unrealizedPct` stays its own column rather than being folded into
 * `unrealizedJpy`: sorting by return and sorting by yen answer different
 * questions — a ¥40k position up 50% and a ¥2M position up 5% rank opposite
 * ways — so collapsing them would take a real capability away.
 */
export const POSITION_SORTABLE = [
  'symbol',
  'quantity',
  'avgCost',
  'price',
  'costBasisJpy',
  'marketValueJpy',
  'weight',
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
 * rows by value descending — so the screen looks untouched until the first
 * click rather than rearranging itself on arrival. A bookmark still naming the
 * Account or Class column, both since removed, lands here too.
 */
export const positionSearchSchema = accountScopeSchema.extend({
  sortBy: z.enum(POSITION_SORTABLE).catch('marketValueJpy'),
  sortDir: z.enum(['asc', 'desc']).catch('desc'),
})

export type PositionSearch = z.infer<typeof positionSearchSchema>
