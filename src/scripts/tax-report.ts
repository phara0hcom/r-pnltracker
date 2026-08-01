import type Decimal from 'decimal.js'
import { loadAllStatements, loadAllTrades } from '../lib/import/loadFixtures'
import { runEngine } from '../lib/pnl/engine'
import { attributeDividends } from '../lib/tax/dividends'
import { buildYearOverYear } from '../lib/tax/report'

const yen = (d: Decimal) => '¥' + d.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const trades = loadAllTrades().trades
const { realized } = runEngine(trades)
const dividends = attributeDividends(loadAllStatements().dividends, trades)
const yoy = buildYearOverYear(realized, dividends, 'CALENDAR')

console.log('\n══ YEAR-OVER-YEAR (settlement-date basis, Jan–Dec) ══\n')
console.log(
  '  Year  ' + 'Taxable 特定'.padStart(14) + 'Est. tax'.padStart(12) +
  'NISA (tax-free)'.padStart(18) + 'Dividends'.padStart(12) + '  Trades  Win%',
)
console.log('  ' + '─'.repeat(78))
for (const y of yoy.years) {
  console.log(
    `  ${y.year}  ` +
      yen(y.netTaxable).padStart(14) +
      yen(y.estimatedCapitalGainsTax).padStart(12) +
      yen(y.nisaGains).padStart(18) +
      yen(y.dividendGross.add(y.nisaDividends)).padStart(12) +
      String(y.tradeCount).padStart(8) +
      (y.winRate == null ? '     —' : `  ${(y.winRate * 100).toFixed(0)}%`.padStart(6)),
  )
}
console.log('  ' + '─'.repeat(78))
console.log(
  '  TOTAL ' + yen(yoy.totals.taxableGains).padStart(14) +
  yen(yoy.totals.estimatedTax).padStart(12) +
  yen(yoy.totals.nisaGains).padStart(18),
)

console.log('\n══ 2026 DETAIL (open tax year) ══')
const y26 = yoy.years.find((y) => y.year === 2026)!
console.log(`  taxable gains      ${yen(y26.taxableGains)}`)
console.log(`  taxable losses     ${yen(y26.taxableLosses)}`)
console.log(`  net taxable        ${yen(y26.netTaxable)}`)
console.log(`  ESTIMATED TAX      ${yen(y26.estimatedCapitalGainsTax)}  (20.315%)`)
console.log(`    income portion   ${yen(y26.incomeTaxPortion)}`)
console.log(`    local portion    ${yen(y26.localTaxPortion)}`)
console.log(`  NISA gains         ${yen(y26.nisaGains)}  ← tax-free`)
console.log(`  net after tax      ${yen(y26.netAfterTax)}`)

console.log('\n══ DIVIDENDS BY ACCOUNT ══')
for (const d of dividends) {
  console.log(
    `  ${d.payDate}  ${d.name.slice(0, 22).padEnd(22)} ${d.accountType.padEnd(15)} ` +
      `gross ${yen(d.grossAmount).padStart(9)}  tax ${yen(d.incomeTax.add(d.localTax)).padStart(7)}  ` +
      `net ${yen(d.netAmount).padStart(9)}${d.attributionConfident ? '' : '  (inferred)'}`,
  )
}
console.log()
