/**
 * Shared primitives for the Rakuten parsers.
 *
 * Rakuten's exports are Shift-JIS, use comma-grouped numbers, `YYYY/M/D` dates,
 * `"-"` as a null marker, and pad Japanese text fields with full-width spaces.
 * Every format needs the same handling, so it lives here once.
 */
import { createHash } from 'node:crypto'
import Decimal from 'decimal.js'
import iconv from 'iconv-lite'
import type { AccountType, AssetClass, TradeSide } from '../domain/types'
import { ZERO } from '../domain/types'

/** Rakuten writes Shift-JIS. Files are small, so decode eagerly. */
export function decodeShiftJis(buf: Buffer | Uint8Array): string {
  return iconv.decode(Buffer.from(buf), 'Shift_JIS')
}

/**
 * Trim ASCII and full-width (U+3000) whitespace.
 * Rakuten right-pads instrument names with 全角スペース, so a plain `.trim()`
 * leaves trailing padding and breaks symbol matching between files.
 */
export function jtrim(s: string | undefined | null): string {
  if (s == null) return ''
  return s.replace(/^[\s　]+|[\s　]+$/g, '')
}

/** Rakuten's null marker is a bare hyphen. */
export function isBlank(s: string | undefined | null): boolean {
  const t = jtrim(s ?? '')
  return t === '' || t === '-' || t === '—' || t === '－'
}

/**
 * Parse a Japanese-formatted number: comma grouping, optional `-`, possibly
 * full-width digits. Returns null for blanks so callers can distinguish
 * "absent" (unsettled trade) from "zero".
 */
export function parseNum(s: string | undefined | null): Decimal | null {
  if (isBlank(s)) return null
  const normalized = jtrim(s)
    // full-width digits/punctuation → ASCII
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，、]/g, ',')
    .replace(/[．]/g, '.')
    .replace(/[▲△]/g, '-') // Japanese negative markers

  // Take the FIRST numeric token rather than stripping all non-digits.
  //
  // The 受渡金額 column encodes Rakuten point usage as `1,000,000(2,251)` —
  // ¥1,000,000 settled, of which ¥2,251 was paid with points. Concatenating
  // every digit turns that into ¥10,000,002,251, which silently destroys the
  // cost basis for any trade that used points.
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(normalized)
  if (!m) return null
  const cleaned = m[0].replace(/,/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  try {
    const d = new Decimal(cleaned)
    return d.isFinite() ? d : null
  } catch {
    return null
  }
}

/**
 * The parenthesized second figure in `1,000,000(2,251)` — Rakuten points
 * applied to the purchase. Points still form part of the acquisition cost, so
 * this is recorded for information and does NOT reduce cost basis.
 */
export function parsePointsUsed(s: string | undefined | null): Decimal | null {
  if (isBlank(s)) return null
  const m = /[（(]\s*([\d,]+)\s*[）)]/.exec(jtrim(s)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)))
  if (!m) return null
  return parseNum(m[1])
}

/** Same as `parseNum` but blanks collapse to 0 — for fee columns where "-" means "none charged". */
export function parseNumOrZero(s: string | undefined | null): Decimal {
  return parseNum(s) ?? ZERO
}

/**
 * Round a derived JPY amount to whole yen.
 *
 * The yen has no subunit, so any figure produced by converting a foreign
 * currency must be an integer before it reaches cost basis, tax, or NISA quota
 * arithmetic — otherwise fractions accumulate and totals drift off the values
 * the broker actually books.
 *
 * The one externally checkable case confirms this: the 2026 成長投資枠 is
 * ¥1,000,000 + ¥861,259 + a USD-settled BRK B purchase. Rounding that purchase
 * to ¥538,741 puts the frame exactly on its ¥2,400,000 cap; leaving it
 * fractional pushes usage 0.238 yen *over* the legal limit.
 */
export function toYen(amount: Decimal): Decimal {
  return amount.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
}

/**
 * Normalize `2026/7/29`, `2026.07.29`, or `2026-07-29` to `2026-07-29`.
 * Returns null when unparseable so the row can be reported rather than
 * silently landing in the wrong tax year.
 */
export function parseDate(s: string | undefined | null): string | null {
  if (isBlank(s)) return null
  const t = jtrim(s).replace(/[年月]/g, '/').replace(/日/g, '')
  const m = /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(t)
  if (!m) return null
  const [, y, mo, d] = m
  const yy = Number(y)
  const mm = Number(mo)
  const dd = Number(d)
  // TODO(nit): the day is range-checked without reference to the month, so
  // 2026-02-30 and 2026-04-31 parse as valid and are returned well-formed. The
  // row then fails at INSERT, where Postgres rejects the date — a 500 on the
  // import instead of a row-level error the user can see and correct.
  // Fix: round-trip the constructed date and reject if it moved, e.g.
  //   const dt = new Date(Date.UTC(yy, mm - 1, dd))
  //   if (dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

/**
 * Map Rakuten's 口座区分 to our enum.
 *
 * The same account appears under different labels across formats — the trade
 * history writes `NISA成長投資枠` while the balance report abbreviates to
 * `Ｎ成長`, and full-width variants show up in both. All are folded here.
 */
export function parseAccountType(raw: string | undefined | null): AccountType | null {
  const t = jtrim(raw).replace(/[Ｎ]/g, 'N').replace(/\s/g, '')
  if (t === '') return null
  // Order matters: 旧NISA must be tested before the generic NISA checks.
  if (t.includes('旧NISA') || t.includes('旧ＮＩＳＡ')) return 'NISA_OLD'
  if (t.includes('つみたて') || t.includes('積立') || t === 'N積立') return 'NISA_TSUMITATE'
  if (t.includes('成長') || t === 'N成長') return 'NISA_GROWTH'
  if (t.includes('非課税')) return 'NISA_OLD' // legacy label in the balance report
  if (t.includes('特定')) return 'SPECIFIC'
  // TODO(nit): 一般口座 is folded into 特定口座. Both are taxable, so every total
  // stays right, but they differ in who files: 特定 (源泉徴収あり) is withheld at
  // source by Rakuten, whereas 一般 is self-reported and nothing is withheld.
  // The tax screen presents an estimate on the 特定 assumption, so a 一般 trade
  // is shown as already-settled tax that in fact is still owed.
  // Fix: add a `GENERAL` member to `AccountType`, treat it as taxable
  // everywhere `SPECIFIC` is, and exclude it from the withheld-at-source figure
  // in `lib/tax/report.ts`. Left folded for now because the current exports
  // contain no 一般 rows.
  if (t.includes('一般')) return 'SPECIFIC'
  return null
}

/** 売買区分 / 取引 → side. */
export function parseSide(raw: string | undefined | null): TradeSide | null {
  const t = jtrim(raw).replace(/\s/g, '')
  if (t === '') return null
  if (t.includes('再投資')) return 'REINVEST'
  if (t.includes('解約') || t.includes('直解')) return 'REDEEM'
  if (t.includes('買付') || t === '買' || t.includes('買い')) return 'BUY'
  if (t.includes('売付') || t === '売' || t.includes('売り')) return 'SELL'
  return null
}

export function assetClassFor(kind: 'JP' | 'US' | 'FUND'): AssetClass {
  return kind === 'JP' ? 'JP_EQUITY' : kind === 'US' ? 'US_EQUITY' : 'FUND'
}

/**
 * Stable identity for a row, so re-importing an overlapping export is a no-op.
 *
 * Deliberately excludes fees and settlement amounts: the same trade appears in
 * both `tradehistory(US)` and `gaikabu` with SEC fees split out differently,
 * and those must collapse to one row rather than duplicating.
 */
export function rowHash(parts: (string | number | Decimal | null | undefined)[]): string {
  const norm = parts.map((p) => {
    if (p == null) return ''
    if (p instanceof Decimal) return p.toFixed()
    return String(p)
  })
  return createHash('sha256').update(norm.join('|')).digest('hex').slice(0, 32)
}

/**
 * Disambiguates rows that share every identifying field.
 *
 * A single order is often filled as several identical executions — the data has
 * 3× KO @ $85.58 on 2026-07-21, and 2× 楽天日経225 @ 15,725 on 2025-12-08.
 * These are distinct trades, so hashing on the fields alone silently drops them.
 *
 * Appending a per-file occurrence ordinal keeps genuine repeats distinct while
 * preserving idempotency: re-reading the same file yields the same ordinals and
 * therefore the same hashes.
 */
export function makeOccurrenceCounter(): (key: string) => number {
  const seen = new Map<string, number>()
  return (key: string) => {
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    return n
  }
}

/**
 * Split a CSV line honouring double-quoted fields.
 *
 * Hand-rolled rather than using csv-parse because these files are *not* valid
 * CSV documents: they are multiple tables with different column counts glued
 * together with `---` separator lines, and a strict parser rejects them.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    // Non-null: `i` is bounded by `line.length`, but noUncheckedIndexedAccess
    // cannot see that.
    const c = line[i]!
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out
}

/** True for the `-----` rules that delimit tables in the statement files. */
export function isSeparator(line: string): boolean {
  const t = jtrim(line).replace(/"/g, '')
  return t.length > 0 && /^-+$/.test(t)
}

/** Strip Rakuten's `(1369)` / `(AAPL)` suffix and padding from an instrument name. */
export function extractCode(nameField: string): { name: string; code: string | null } {
  const raw = jtrim(nameField)
  const m = /^(.*?)[（(]([^（）()]+)[）)]\s*$/.exec(raw)
  if (m) {
    return { name: jtrim(m[1]), code: jtrim(m[2]) }
  }
  return { name: raw, code: null }
}

/**
 * Full-width → half-width for alphanumerics.
 * The balance report writes tickers as `ＡＡＰＬ`; the trade history uses `AAPL`.
 * Both must resolve to the same instrument.
 */
export function toHalfWidth(s: string): string {
  return (
    jtrim(s)
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      // Rakuten mixes several dash codepoints for the same character across
      // files — U+FF0D in the balance report vs U+2212 elsewhere — so instrument
      // names fail to join unless they are all folded to ASCII hyphen.
      //
      // TODO(nit): `ー` (U+30FC, katakana prolonged sound mark) is matched only
      // to be mapped back to itself. It is a letter in fund names (ファンド),
      // never a dash, so folding it would corrupt them — but including it in the
      // class and then special-casing it reads as a bug every time.
      // Fix: drop `ー` from the character class and delete the callback:
      //   .replace(/[－−–—―]/g, '-')
      .replace(/[－−–—―ー]/g, (c) => (c === 'ー' ? 'ー' : '-'))
      .replace(/　/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}
