/** Reproduce the 500 with the exact new files. */
import { readFileSync } from 'node:fs'
import { previewImport, parseFile } from '../db/import.service'

const files = [
  '/Users/tamer/Downloads/stock/tradehistory(JP)_20260801.csv',
  '/Users/tamer/Downloads/stock/tradehistory(US)_20260801.csv',
]

for (const path of files) {
  const name = path.split('/').pop()!
  const bytes = Uint8Array.from(readFileSync(path))
  console.log(`\n=== ${name} (${String(bytes.length)} bytes) ===`)
  try {
    const parsed = parseFile(name, bytes)
    console.log(`  parseFile ok: ${String(parsed.trades.length)} trades, ${String(parsed.errors.length)} errors`)
    for (const e of parsed.errors.slice(0, 3)) console.log(`    err line ${String(e.line)}: ${e.message}`)
  } catch (e) {
    console.log(`  parseFile THREW: ${(e as Error).message}`)
    console.log((e as Error).stack?.split('\n').slice(0, 6).join('\n'))
    continue
  }
  try {
    const p = await previewImport('seed-owner', name, bytes)
    console.log(`  preview ok: ${p.summary}`)
  } catch (e) {
    console.log(`  previewImport THREW: ${(e as Error).message}`)
    console.log((e as Error).stack?.split('\n').slice(0, 8).join('\n'))
  }
}
process.exit(0)
