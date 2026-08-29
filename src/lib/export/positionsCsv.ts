/**
 * Open positions → CSV.
 *
 * Pure and DB-free like the rest of `lib`: rows in, one string out. The caller
 * decides *which* rows and in *what* order, so the file always matches the
 * table it was exported from — account filter and sort column included.
 *
 * Values are written as the exact decimal strings the server sent, never as the
 * yen-formatted display strings. A cell reading "¥123,456" is a picture of a
 * number, not a number, and the whole point of a CSV is that a spreadsheet can
 * do arithmetic on it.
 */
import type { AccountFilter } from '../domain/types'
import { todayLocal } from '../localDate'
import { csvDocument } from './csv'

/**
 * The fields the CSV reads, declared structurally so `lib` need not import the
 * server's `PositionRow` — that type is satisfied by this one, not the reverse.
 */
export interface PositionCsvRow {
  symbol: string
  name: string
  assetClass: string
  accountType: string
  currency: string
  quantity: string
  avgPriceNative: string
  avgCostPerUnit: string
  avgFxRate: string
  costBasisJpy: string
  currentPrice: string | null
  marketValueJpy: string | null
  unrealizedJpy: string | null
  unrealizedPct: number | null
  priceAsOf: string | null
  priceSource: string | null
}

/**
 * Display labels for the two enum columns, supplied by the caller.
 *
 * Injected rather than imported: they live in `components/format.ts`, and
 * nothing in `lib` reaches up into `components`. Keeping that direction one-way
 * is what lets this module be tested without a DOM.
 */
export interface PositionCsvLabels {
  account: Record<string, string>
  assetClass: Record<string, string>
}

interface Column {
  header: string
  value: (row: PositionCsvRow, labels: PositionCsvLabels) => string
}

/** A null figure becomes an empty cell — an unpriced position is unmeasured, not zero. */
const blank = (value: string | null): string => value ?? ''

/**
 * Columns in the order the Positions table renders them, then the four fields
 * the screen has no room for.
 *
 * Price provenance is the reason those last two are here: once the file leaves
 * the app there is otherwise no way to tell a quote fetched minutes ago from a
 * manual override typed in months ago, and both render identically on screen.
 */
const COLUMNS: readonly Column[] = [
  { header: 'Symbol', value: (row) => row.symbol },
  { header: 'Name', value: (row) => row.name },
  { header: 'Class', value: (row, labels) => labels.assetClass[row.assetClass] ?? row.assetClass },
  { header: 'Account', value: (row, labels) => labels.account[row.accountType] ?? row.accountType },
  { header: 'Currency', value: (row) => row.currency },
  { header: 'Quantity', value: (row) => row.quantity },
  { header: 'Avg cost (native)', value: (row) => row.avgPriceNative },
  { header: 'Avg cost (JPY)', value: (row) => row.avgCostPerUnit },
  { header: 'Avg FX rate', value: (row) => row.avgFxRate },
  { header: 'Cost basis (JPY)', value: (row) => row.costBasisJpy },
  { header: 'Price (native)', value: (row) => blank(row.currentPrice) },
  { header: 'Market value (JPY)', value: (row) => blank(row.marketValueJpy) },
  { header: 'Unrealized (JPY)', value: (row) => blank(row.unrealizedJpy) },
  {
    // A ratio, not a percentage: format the column as % in a spreadsheet and it
    // reads correctly. Fixed to 6 places so a float artifact like
    // 0.12300000000000001 does not land in the file.
    header: 'Unrealized %',
    value: (row) => (row.unrealizedPct == null ? '' : row.unrealizedPct.toFixed(6)),
  },
  {
    // The full UTC timestamp, verbatim. Truncating it to a date would reintroduce
    // exactly the bug `localDate.ts` exists to prevent — for JST the UTC date is
    // the previous day until 09:00.
    header: 'Price as of',
    value: (row) => blank(row.priceAsOf),
  },
  { header: 'Price source', value: (row) => blank(row.priceSource) },
]

export function positionsCsv(
  rows: readonly PositionCsvRow[],
  labels: PositionCsvLabels,
): string {
  // 'excel' — this file is opened by a person in a spreadsheet, and without the
  // BOM every Japanese fund name and account label arrives as mojibake.
  return csvDocument(
    [
      COLUMNS.map((column) => column.header),
      ...rows.map((row) => COLUMNS.map((column) => column.value(row, labels))),
    ],
    'excel',
  )
}

/**
 * `positions-2026-08-29.csv`, or `positions-nisa-2026-08-29.csv` when the
 * account switch is filtered — so two exports taken the same day for different
 * scopes do not overwrite each other in the downloads folder.
 *
 * Dated from `todayLocal`, never `toISOString`: the latter names the file with
 * yesterday's date every JST morning before 09:00.
 */
export function positionsCsvFilename(account: AccountFilter, today = todayLocal()): string {
  const scope = account === 'ALL' ? '' : `-${account.toLowerCase()}`
  return `positions${scope}-${today}.csv`
}
