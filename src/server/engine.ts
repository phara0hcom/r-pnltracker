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
 * `docs/server-only-modules.md`. That is also why importing Sentry at module
 * scope is safe in this file and would not be in `screens.ts`.
 */
import * as Sentry from '@sentry/tanstackstart-react'
import { listTrades } from '~/db/trades.service'
import { matchesAccountFilter, type AccountFilter } from '~/lib/domain/types'
import { reportWarning } from '~/lib/observability/report'
import { runEngine, type EngineWarning } from '~/lib/pnl/engine'

/**
 * Warnings already reported by this instance.
 *
 * The engine's warnings are a property of the stored history, not of the request:
 * the same trades yield the same warnings on every navigation, so reporting them
 * unconditionally would spend the month's error budget restating one fact. Sentry
 * would group them, but it would still have to receive them.
 *
 * Module scope, so a warm function reuses it — the same reason `db/index.ts`
 * caches its pool on `globalThis`. A cold start re-reports, which is wanted: it
 * confirms the condition is still there rather than only that it once was.
 */
const reportedWarnings = new Set<string>()

function fingerprintOf(warning: EngineWarning): string {
  return `${warning.symbol}|${warning.accountType}|${warning.message}`
}

/**
 * Surfaces what the engine already knew and had no way to say.
 *
 * `runEngine` has always returned `warnings`, and until now only the CLI reports
 * in `src/scripts/` ever read them — so a close with no open position, or a close
 * clamped because it exceeded the units held, was visible to whoever happened to
 * run `npm run report` and to nobody else. Both mean the trade history is
 * incomplete or out of order, which is exactly the condition that makes cost
 * basis wrong.
 *
 * The messages carry share quantities, which the scrubbing contract keeps as
 * position counts; neither warning site in the engine embeds a monetary amount.
 */
function reportEngineWarnings(warnings: EngineWarning[]): void {
  for (const warning of warnings) {
    const fingerprint = fingerprintOf(warning)
    if (reportedWarnings.has(fingerprint)) continue
    reportedWarnings.add(fingerprint)

    reportWarning(
      `engine warning: ${warning.message}`,
      {
        symbol: warning.symbol,
        accountType: warning.accountType,
        tradeDate: warning.tradeDate,
      },
      ['engine-warning', warning.message],
    )
  }
}

/**
 * Loads trades and runs the engine once — every screen starts here.
 *
 * The account filter is applied to the trades *before* the engine runs, which
 * is exact rather than approximate: pools are keyed `(symbol × accountType)`,
 * so dropping whole accounts cannot alter the pools that remain. Filtering the
 * engine's *output* instead would be wrong — a 特定 sell would still have been
 * averaged against NISA units.
 *
 * ## Why the spans are here
 *
 * Seven of the eight GET screen functions funnel through this one call, and its
 * cost has two quite different halves: one round trip to a database in Singapore
 * (~75ms — see the region note in `vite.config.ts`) and a synchronous pass over
 * every trade in 40-digit `Decimal`. Which of the two dominates decides whether
 * the answer is co-locating the database or reducing the arithmetic, and until
 * now nothing recorded either.
 *
 * They are measured by hand because they cannot be measured automatically: Nitro
 * inlines `pg` into the server bundle, so OpenTelemetry has no module load to
 * patch and emits no database spans at all. See `src/instrument.server.ts`.
 */
export async function engineFor(userId: string, account: AccountFilter = 'ALL') {
  return Sentry.startSpan(
    { name: 'engineFor', op: 'function', attributes: { account } },
    async (span) => {
      const records = await Sentry.startSpan(
        { name: 'listTrades', op: 'db.query' },
        () => listTrades(userId),
      )

      const everyTrade = records.map((record) => record.trade)
      const list = everyTrade.filter((trade) =>
        matchesAccountFilter(trade.accountType, account),
      )

      const engine = Sentry.startSpan({ name: 'runEngine', op: 'pnl.engine' }, () =>
        runEngine(list),
      )

      span.setAttribute('trades', list.length)
      span.setAttribute('positions', engine.positions.length)
      reportEngineWarnings(engine.warnings)

      // `unfilteredTrades` is returned for the rare lookup that must see across the
      // switch — matching a 再投資 to its dividend, where Rakuten's two rows can sit
      // in different accounts. Everything else wants `trades`.
      //
      // `records` carries the row ids, memos and per-trade journals alongside. The
      // calendar needs those and used to re-read them with a second `listTrades`,
      // which fetched and re-mapped the whole history twice per month viewed.
      return { records, trades: list, unfilteredTrades: everyTrade, engine }
    },
  )
}
