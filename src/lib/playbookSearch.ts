/**
 * The Playbook table's URL search params, and the filter they describe.
 *
 * Built on the account and market scopes for the reason `positionSearch.ts` is: a
 * zod object strips unknown keys, so a screen that declares its own params must
 * still carry `scope` or the switch is discarded the moment you sort.
 *
 * Every field falls back to *absent*, so a default never gets written into the
 * address by the next `(prev) => ({ ...prev, … })` navigation.
 */
import { z } from 'zod'
import { accountScopeSchema } from './accountScope'
import {
  matchesAccountFilter,
  matchesMarketFilter,
  type AccountFilter,
  type AccountType,
  type AssetClass,
  type MarketFilter,
} from './domain/types'
import { marketScopeSchema } from './marketScope'
import type { JournalKind, PositionStatus } from './playbook/types'

export const PLAYBOOK_SORTABLE = [
  'symbol',
  'setup',
  'status',
  'opened',
  'closed',
  'result',
  'r',
  'entry',
  'exit',
  'risk',
  'overall',
] as const

export type PlaybookSortKey = (typeof PLAYBOOK_SORTABLE)[number]

export const STATUS_FILTERS = ['AWAITING_IMPORT', 'OPEN', 'CLOSED', 'MISSING'] as const
export const KIND_FILTERS = ['REAL', 'PAPER', 'ALL'] as const
export type KindFilter = (typeof KIND_FILTERS)[number]

/** No `sortBy` is the default: open first, then most recent — the order the server sends. */
export const playbookSearchSchema = accountScopeSchema.extend(marketScopeSchema.shape).extend({
  setup: z.string().min(1).optional().catch(undefined),
  status: z.enum(STATUS_FILTERS).optional().catch(undefined),
  kind: z.enum(KIND_FILTERS).optional().catch(undefined),
  sortBy: z.enum(PLAYBOOK_SORTABLE).optional().catch(undefined),
  sortDir: z.enum(['asc', 'desc']).optional().catch(undefined),
})

export type PlaybookSearch = z.infer<typeof playbookSearchSchema>

export interface PlaybookFilters {
  account: AccountFilter
  market: MarketFilter
  setup?: string
  status?: PositionStatus
  kind: KindFilter
}

interface Filterable {
  kind: JournalKind
  accountType: AccountType | null
  assetClass: AssetClass
  setupId: string | null
  status: PositionStatus
}

/**
 * A paper position has no account, so the account switch has nothing to say about
 * it. On the Paper view it is ignored — the switch is carried across every screen,
 * and honouring it there would empty the view for a reason unrelated to paper.
 */
export function matchesPlaybookFilters(row: Filterable, filters: PlaybookFilters): boolean {
  if (filters.kind !== 'ALL' && row.kind !== filters.kind) return false
  if (!matchesMarketFilter(row.assetClass, filters.market)) return false
  if (filters.setup && row.setupId !== filters.setup) return false
  if (filters.status && row.status !== filters.status) return false
  if (filters.kind === 'PAPER') return true
  if (row.accountType === null) return filters.account === 'ALL'
  return matchesAccountFilter(row.accountType, filters.account)
}
