import type Decimal from 'decimal.js'
import { loadAllTrades } from '../lib/import/loadFixtures'
import { buildNisaReport, legacyNisaBookValue, ANNUAL_TOTAL_LIMIT } from '../lib/nisa/quota'
import { runEngine } from '../lib/pnl/engine'

const yen = (d: Decimal) => '¥' + d.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const bar = (u: number, w = 28) => {
  const f = Math.min(Math.round(u * w), w)
  return '[' + '█'.repeat(f) + '·'.repeat(w - f) + ']'
}

const trades = loadAllTrades().trades
const { realized } = runEngine(trades)
const r = buildNisaReport(trades, realized, 2026)

console.log('\n══ LIFETIME 非課税保有限度額 (簿価ベース) ══')
const L = r.lifetime
console.log(`  ${bar(L.utilization)} ${yen(L.used)} / ${yen(L.limit)}  (${(L.utilization * 100).toFixed(1)}%)`)
console.log(`  remaining headroom        ${yen(L.remaining)}`)
const gu = L.growthUsed.div(L.growthSubCap).toNumber()
console.log(`  成長投資枠 sub-cap        ${bar(gu)} ${yen(L.growthUsed)} / ${yen(L.growthSubCap)}`)
console.log(`  restoring ${L.restorationDate}          ${yen(L.pendingRestoration)}  (from 2026 sales)`)
console.log(`  旧NISA (separate system)  ${yen(legacyNisaBookValue(runEngine(trades).positions))}  — excluded from the ¥18M`)

console.log('\n══ ANNUAL FRAMES ══')
let curYear = 0
for (const a of r.annual) {
  if (a.year !== curYear) { curYear = a.year; console.log(`  ${a.year}`) }
  const label = a.frame === 'NISA_GROWTH' ? '成長投資枠  ' : 'つみたて投資枠'
  console.log(
    `    ${label} ${bar(a.utilization, 22)} ${yen(a.used).padStart(12)} / ${yen(a.limit).padStart(12)}` +
      `  left ${yen(a.remaining).padStart(11)}${a.isMaxed ? '   ★ MAXED' : ''}`,
  )
}

console.log('\n══ CONTRIBUTIONS BY YEAR ══')
for (const c of r.contributionsByYear) {
  const tot = c.growth.add(c.tsumitate)
  console.log(
    `  ${c.year}  成長 ${yen(c.growth).padStart(12)}  つみたて ${yen(c.tsumitate).padStart(12)}` +
      `  total ${yen(tot).padStart(12)} / ${yen(ANNUAL_TOTAL_LIMIT)}`,
  )
}
console.log()
