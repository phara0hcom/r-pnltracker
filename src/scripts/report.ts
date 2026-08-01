/**
 * Diagnostic report over the real exports. Run: `npm run report`.
 * Not part of the app — a fast way to eyeball engine output against reality.
 */
import Decimal from 'decimal.js'
import { loadAllStatements, loadAllTrades } from '../lib/import/loadFixtures'
import { bySettlementYear, runEngine, totalRealized } from '../lib/pnl/engine'

const yen = (d: Decimal) => `¥${d.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

const { trades, errors } = loadAllTrades()
const statements = loadAllStatements()
const engine = runEngine(trades)

console.log(`\n=== IMPORT ===`)
console.log(`trades           ${trades.length}`)
console.log(`parse errors     ${errors.length}`)
console.log(`dividends        ${statements.dividends.length}`)
console.log(`snapshots        ${statements.snapshots.length}`)
console.log(`cash movements   ${statements.cashMovements.length}`)

console.log(`\n=== ENGINE WARNINGS (${engine.warnings.length}) ===`)
for (const w of engine.warnings) {
  console.log(`  ${w.tradeDate}  ${w.symbol.slice(0, 28).padEnd(28)} ${w.accountType.padEnd(15)} ${w.message}`)
}

console.log(`\n=== REALIZED BY SETTLEMENT YEAR ===`)
const byYear = [...bySettlementYear(engine.realized).entries()].sort((a, b) => a[0] - b[0])
for (const [year, events] of byYear) {
  const taxable = events.filter((e) => e.isTaxable)
  const exempt = events.filter((e) => !e.isTaxable)
  console.log(
    `  ${year}  n=${String(events.length).padStart(3)}  ` +
      `特定 ${yen(totalRealized(taxable)).padStart(14)}  ` +
      `NISA ${yen(totalRealized(exempt)).padStart(14)}`,
  )
}
console.log(`  TOTAL realized  ${yen(totalRealized(engine.realized))}`)

console.log(`\n=== OPEN POSITIONS (${engine.positions.length}) ===`)
const sorted = [...engine.positions].sort((a, b) => b.costBasisJpy.cmp(a.costBasisJpy))
for (const p of sorted.slice(0, 40)) {
  console.log(
    `  ${p.symbol.slice(0, 30).padEnd(30)} ${p.accountType.padEnd(15)} ` +
      `qty=${p.quantity.toFixed(0).padStart(10)}  cost=${yen(p.costBasisJpy).padStart(14)}`,
  )
}
const totalCost = engine.positions.reduce((a, p) => a.add(p.costBasisJpy), new Decimal(0))
console.log(`  TOTAL cost basis ${yen(totalCost)}`)

console.log(`\n=== DIVIDENDS ===`)
for (const d of statements.dividends) {
  console.log(`  ${d.payDate}  ${d.kind.padEnd(12)} ${d.name.slice(0, 30).padEnd(30)} ${yen(d.netAmount)}`)
}
const divTotal = statements.dividends.reduce((a, d) => a.add(d.netAmount), new Decimal(0))
console.log(`  TOTAL ${yen(divTotal)}`)
console.log()
