/**
 * Loads the CSVs in `csv/` into the database and verifies the round trip.
 *
 * Run: `npm run seed`
 *
 * Idempotent — running it repeatedly imports nothing new, which is itself the
 * check that dedupe works against a real unique index rather than only in
 * memory.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import Decimal from 'decimal.js'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { commitImport } from '../db/import.service'
import { user } from '../db/schema'
import { listTrades } from '../db/trades.service'
import { torizanFiles, tradeHistoryFiles } from '../lib/import/loadFixtures'
import { runEngine } from '../lib/pnl/engine'

const yen = (d: Decimal) => '¥' + d.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/**
 * Placeholder owner row.
 *
 * Trades are foreign-keyed to a user, but Google sign-in is not wired up yet.
 * Seeding under a fixed id means the data is already correct when auth lands —
 * the real session just needs to resolve to this id, or the rows get reassigned
 * once with a single UPDATE.
 */
const SEED_USER_ID = 'seed-owner'
const SEED_EMAIL = process.env.ALLOWED_EMAIL ?? 'owner@localhost'

async function ensureUser(): Promise<string> {
  const existing = await db.select().from(user).where(eq(user.id, SEED_USER_ID))
  if (existing.length === 0) {
    await db.insert(user).values({
      id: SEED_USER_ID,
      name: 'Owner',
      email: SEED_EMAIL,
      emailVerified: true,
    })
    console.log(`created seed user ${SEED_USER_ID} <${SEED_EMAIL}>`)
  }
  return SEED_USER_ID
}

async function main() {
  const userId = await ensureUser()

  // Trade history first: dividend attribution needs the holdings to exist.
  const files = [...tradeHistoryFiles(), ...torizanFiles()]
  if (files.length === 0) {
    console.error('No CSVs found in csv/ — nothing to seed.')
    process.exit(1)
  }

  console.log(`\n=== IMPORTING ${String(files.length)} FILES ===`)
  let totalTrades = 0
  let totalDividends = 0
  let totalSkipped = 0

  for (const path of files) {
    const name = basename(path)
    const result = await commitImport(userId, name, readFileSync(path))
    totalTrades += result.tradesInserted
    totalDividends += result.dividendsInserted
    totalSkipped += result.duplicatesSkipped
    const bits = [`${String(result.tradesInserted)} trades`]
    if (result.dividendsInserted) bits.push(`${String(result.dividendsInserted)} dividends`)
    if (result.snapshotsInserted) bits.push(`${String(result.snapshotsInserted)} snapshots`)
    if (result.duplicatesSkipped) bits.push(`${String(result.duplicatesSkipped)} dup`)
    if (result.errors) bits.push(`${String(result.errors)} ERRORS`)
    console.log(`  ${name.padEnd(38)} ${bits.join(', ')}`)
  }

  console.log(
    `\n  inserted: ${String(totalTrades)} trades, ${String(totalDividends)} dividends` +
      `  |  skipped as duplicates: ${String(totalSkipped)}`,
  )

  // ── Verify the round trip through Postgres ────────────────────────────────
  console.log('\n=== VERIFYING FROM DATABASE ===')
  const records = await listTrades(userId)
  console.log(`  trades read back      ${String(records.length)}`)

  const engine = runEngine(records.map((r) => r.trade))
  console.log(`  engine warnings       ${String(engine.warnings.length)}`)
  console.log(`  open positions        ${String(engine.positions.length)}`)
  console.log(`  realized events       ${String(engine.realized.length)}`)

  const realized = engine.realized.reduce((a, e) => a.add(e.realizedJpy), new Decimal(0))
  console.log(`  total realized P&L    ${yen(realized)}`)

  const fractional = records.filter((r) => !r.trade.netAmountJpy.mod(1).isZero())
  console.log(`  fractional-yen rows   ${String(fractional.length)}  (must be 0)`)

  console.log('\nDone. Re-run to confirm the import is idempotent.')
  process.exit(0)
}

void main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
