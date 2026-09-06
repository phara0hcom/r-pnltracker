/**
 * The shared server-side entry to the P&L engine.
 *
 * Lives apart from `screens.ts` for a bundling reason, not an organisational
 * one. `screens.ts` and `exit.ts` both export server functions, so both keep a
 * client stub; Start strips the handler bodies from that stub and then drops
 * the imports those bodies were the only user of. An *exported* helper is not
 * droppable — the compiler cannot know nothing imports it — so while
 * `engineFor` lived in `screens.ts` it kept `~/db/trades.service` referenced,
 * and Rollup preserves an imported module's side effects whether or not its
 * exports are used. `db/index.ts` opens a `pg` pool at module scope, so the
 * browser bundle ended up carrying the whole of `pg`, `drizzle-orm` and the
 * database schema.
 *
 * Here, both callers reference `engineFor` only from inside handler bodies, so
 * nothing survives into the client build at all. See
 * `docs/server-only-modules.md`.
 */
import { listTrades } from '~/db/trades.service'
import { matchesAccountFilter, type AccountFilter } from '~/lib/domain/types'
import { runEngine } from '~/lib/pnl/engine'

/**
 * Loads trades and runs the engine once — every screen starts here.
 *
 * The account filter is applied to the trades *before* the engine runs, which
 * is exact rather than approximate: pools are keyed `(symbol × accountType)`,
 * so dropping whole accounts cannot alter the pools that remain. Filtering the
 * engine's *output* instead would be wrong — a 特定 sell would still have been
 * averaged against NISA units.
 */
export async function engineFor(userId: string, account: AccountFilter = 'ALL') {
  const records = await listTrades(userId)
  const everyTrade = records.map((record) => record.trade)
  const list = everyTrade.filter((trade) => matchesAccountFilter(trade.accountType, account))
  // `unfilteredTrades` is returned for the rare lookup that must see across the
  // switch — matching a 再投資 to its dividend, where Rakuten's two rows can sit
  // in different accounts. Everything else wants `trades`.
  //
  // `records` carries the row ids, memos and per-trade journals alongside. The
  // calendar needs those and used to re-read them with a second `listTrades`,
  // which fetched and re-mapped the whole history twice per month viewed.
  return { records, trades: list, unfilteredTrades: everyTrade, engine: runEngine(list) }
}
