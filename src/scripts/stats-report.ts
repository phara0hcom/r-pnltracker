import type Decimal from 'decimal.js'
import { loadAllTrades } from '../lib/import/loadFixtures'
import { runEngine } from '../lib/pnl/engine'
import { attributeFx } from '../lib/pnl/fxAttribution'
import { bySymbol, computeStats } from '../lib/stats/stats'

const yen = (d: Decimal) => '¥' + d.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const pct = (n: number | null) => (n == null ? '—' : (n * 100).toFixed(1) + '%')
const num = (n: number | null, d = 2) => (n == null ? '—' : n.toFixed(d))

const { realized } = runEngine(loadAllTrades().trades)
const s = computeStats(realized)

console.log('\n══ TRADING STATS (all closed trades) ══')
console.log(`  trades              ${s.tradeCount}   (${s.winCount}W / ${s.lossCount}L / ${s.breakevenCount}BE)`)
console.log(`  win rate            ${pct(s.winRate)}`)
console.log(`  gross profit        ${yen(s.grossProfit)}`)
console.log(`  gross loss          ${yen(s.grossLoss)}`)
console.log(`  net P&L             ${yen(s.netPnl)}`)
console.log(`  avg win             ${s.avgWin ? yen(s.avgWin) : '—'}`)
console.log(`  avg loss            ${s.avgLoss ? yen(s.avgLoss) : '—'}`)
console.log(`  payoff ratio        ${num(s.payoffRatio)}`)
console.log(`  profit factor       ${num(s.profitFactor)}`)
console.log(`  max drawdown        ${yen(s.maxDrawdown)}  (${pct(s.maxDrawdownPct)})`)
console.log(`  longest win streak  ${s.longestWinStreak}`)
console.log(`  longest loss streak ${s.longestLossStreak}`)
console.log(`  avg holding (wtd)   ${num(s.avgHoldingDays, 0)} days`)
console.log(`  median holding      ${num(s.medianHoldingDays, 0)} days`)
console.log(`  largest win         ${s.largestWin ? yen(s.largestWin.realizedJpy) + '  ' + s.largestWin.symbol : '—'}`)
console.log(`  largest loss        ${s.largestLoss ? yen(s.largestLoss.realizedJpy) + '  ' + s.largestLoss.symbol : '—'}`)

console.log('\n══ BY ACCOUNT ══')
for (const acct of ['SPECIFIC', 'NISA_GROWTH', 'NISA_TSUMITATE', 'NISA_OLD'] as const) {
  const a = computeStats(realized, { accountTypes: [acct] })
  if (!a.tradeCount) continue
  console.log(`  ${acct.padEnd(15)} n=${String(a.tradeCount).padStart(3)}  win ${pct(a.winRate).padStart(6)}  net ${yen(a.netPnl).padStart(13)}  PF ${num(a.profitFactor)}`)
}

console.log('\n══ BY ASSET CLASS ══')
for (const ac of ['JP_EQUITY', 'US_EQUITY', 'FUND'] as const) {
  const a = computeStats(realized, { assetClasses: [ac] })
  if (!a.tradeCount) continue
  console.log(`  ${ac.padEnd(15)} n=${String(a.tradeCount).padStart(3)}  win ${pct(a.winRate).padStart(6)}  net ${yen(a.netPnl).padStart(13)}  PF ${num(a.profitFactor)}`)
}

const fx = attributeFx(realized)
console.log('\n══ US CURRENCY ATTRIBUTION ══')
console.log(`  closes analysed     ${fx.events.length}`)
console.log(`  stock movement      ${yen(fx.stockEffectJpy).padStart(13)}`)
console.log(`  YEN movement        ${yen(fx.fxEffectJpy).padStart(13)}   ← invisible in USD terms`)
console.log(`  fees + rounding     ${yen(fx.costEffectJpy).padStart(13)}`)
console.log(`  ─────────────────────────────────`)
console.log(`  total US realized   ${yen(fx.totalJpy).padStart(13)}`)
console.log(`  FX share of gross   ${pct(fx.fxShare)}`)
console.log(`  avg entry USD/JPY   ${fx.avgEntryFx.toFixed(2)}`)
console.log(`  avg exit  USD/JPY   ${fx.avgExitFx.toFixed(2)}`)

console.log('\n══ TOP / BOTTOM SYMBOLS ══')
const ranked = bySymbol(realized)
for (const r of ranked.slice(0, 6)) console.log(`  +  ${r.symbol.slice(0,28).padEnd(28)} ${yen(r.netPnl).padStart(12)}  (${r.tradeCount} closes, ${pct(r.winRate)} win)`)
for (const r of ranked.slice(-5)) console.log(`  -  ${r.symbol.slice(0,28).padEnd(28)} ${yen(r.netPnl).padStart(12)}  (${r.tradeCount} closes, ${pct(r.winRate)} win)`)
console.log()
