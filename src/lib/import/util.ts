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
export function jtrim(raw: string | undefined | null): string {
  if (raw == null) return ''
  return raw.replace(/^[\s　]+|[\s　]+$/g, '')
}

/** Rakuten's null marker is a bare hyphen. */
export function isBlank(raw: string | undefined | null): boolean {
  const trimmed = jtrim(raw ?? '')
  return trimmed === '' || trimmed === '-' || trimmed === '—' || trimmed === '－'
}

/**
 * Parse a Japanese-formatted number: comma grouping, optional `-`, possibly
 * full-width digits. Returns null for blanks so callers can distinguish
 * "absent" (unsettled trade) from "zero".
 */
export function parseNum(raw: string | undefined | null): Decimal | null {
  if (isBlank(raw)) return null
  const normalized = jtrim(raw)
    // full-width digits/punctuation → ASCII
    .replace(/[０-９]/g, (fullWidth) => String.fromCharCode(fullWidth.charCodeAt(0) - 0xfee0))
    .replace(/[，、]/g, ',')
    .replace(/[．]/g, '.')
    .replace(/[▲△]/g, '-') // Japanese negative markers

  // Take the FIRST numeric token rather than stripping all non-digits.
  //
  // The 受渡金額 column encodes Rakuten point usage as `1,000,000(2,251)` —
  // ¥1,000,000 settled, of which ¥2,251 was paid with points. Concatenating
  // every digit turns that into ¥10,000,002,251, which silently destroys the
  // cost basis for any trade that used points.
  const firstNumber = /-?\d[\d,]*(?:\.\d+)?/.exec(normalized)
  if (!firstNumber) return null
  const cleaned = firstNumber[0].replace(/,/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  try {
    const parsed = new Decimal(cleaned)
    return parsed.isFinite() ? parsed : null
  } catch {
    return null
  }
}

/**
 * The parenthesized second figure in `1,000,000(2,251)` — Rakuten points
 * applied to the purchase. Points still form part of the acquisition cost, so
 * this is recorded for information and does NOT reduce cost basis.
 */
export function parsePointsUsed(raw: string | undefined | null): Decimal | null {
  if (isBlank(raw)) return null
  const inParentheses = /[（(]\s*([\d,]+)\s*[）)]/.exec(
    jtrim(raw).replace(/[０-９]/g, (fullWidth) =>
      String.fromCharCode(fullWidth.charCodeAt(0) - 0xfee0),
    ),
  )
  if (!inParentheses) return null
  return parseNum(inParentheses[1])
}

/** Same as `parseNum` but blanks collapse to 0 — for fee columns where "-" means "none charged". */
export function parseNumOrZero(raw: string | undefined | null): Decimal {
  return parseNum(raw) ?? ZERO
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
export function parseDate(raw: string | undefined | null): string | null {
  if (isBlank(raw)) return null
  const withSlashes = jtrim(raw).replace(/[年月]/g, '/').replace(/日/g, '')
  const parts = /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(withSlashes)
  if (!parts) return null
  const [, rawYear, rawMonth, rawDay] = parts
  const year = Number(rawYear)
  const month = Number(rawMonth)
  const day = Number(rawDay)
  // TODO(nit): the day is range-checked without reference to the month, so
  // 2026-02-30 and 2026-04-31 parse as valid and are returned well-formed. The
  // row then fails at INSERT, where Postgres rejects the date — a 500 on the
  // import instead of a row-level error the user can see and correct.
  // Fix: round-trip the constructed date and reject if it moved, e.g.
  //   const asDate = new Date(Date.UTC(year, month - 1, day))
  //   if (asDate.getUTCMonth() !== month - 1 || asDate.getUTCDate() !== day) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Map Rakuten's 口座区分 to our enum.
 *
 * The same account appears under different labels across formats — the trade
 * history writes `NISA成長投資枠` while the balance report abbreviates to
 * `Ｎ成長`, and full-width variants show up in both. All are folded here.
 */
export function parseAccountType(raw: string | undefined | null): AccountType | null {
  const label = jtrim(raw).replace(/[Ｎ]/g, 'N').replace(/\s/g, '')
  if (label === '') return null
  // Order matters: 旧NISA must be tested before the generic NISA checks.
  if (label.includes('旧NISA') || label.includes('旧ＮＩＳＡ')) return 'NISA_OLD'
  if (label.includes('つみたて') || label.includes('積立') || label === 'N積立')
    return 'NISA_TSUMITATE'
  if (label.includes('成長') || label === 'N成長') return 'NISA_GROWTH'
  if (label.includes('非課税')) return 'NISA_OLD' // legacy label in the balance report
  if (label.includes('特定')) return 'SPECIFIC'
  // TODO(nit): 一般口座 is folded into 特定口座. Both are taxable, so every total
  // stays right, but they differ in who files: 特定 (源泉徴収あり) is withheld at
  // source by Rakuten, whereas 一般 is self-reported and nothing is withheld.
  // The tax screen presents an estimate on the 特定 assumption, so a 一般 trade
  // is shown as already-settled tax that in fact is still owed.
  // Fix: add a `GENERAL` member to `AccountType`, treat it as taxable
  // everywhere `SPECIFIC` is, and exclude it from the withheld-at-source figure
  // in `lib/tax/report.ts`. Left folded for now because the current exports
  // contain no 一般 rows.
  if (label.includes('一般')) return 'SPECIFIC'
  return null
}

/** 売買区分 / 取引 → side. */
export function parseSide(raw: string | undefined | null): TradeSide | null {
  const label = jtrim(raw).replace(/\s/g, '')
  if (label === '') return null
  if (label.includes('再投資')) return 'REINVEST'
  if (label.includes('解約') || label.includes('直解')) return 'REDEEM'
  if (label.includes('買付') || label === '買' || label.includes('買い')) return 'BUY'
  if (label.includes('売付') || label === '売' || label.includes('売り')) return 'SELL'
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
  const normalized = parts.map((part) => {
    if (part == null) return ''
    if (part instanceof Decimal) return part.toFixed()
    return String(part)
  })
  return createHash('sha256').update(normalized.join('|')).digest('hex').slice(0, 32)
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
  const seenCount = new Map<string, number>()
  return (key: string) => {
    const alreadySeen = seenCount.get(key) ?? 0
    seenCount.set(key, alreadySeen + 1)
    return alreadySeen
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
  const fields: string[] = []
  let field = ''
  let inQuotes = false
  for (let index = 0; index < line.length; index++) {
    // Non-null: `index` is bounded by `line.length`, but noUncheckedIndexedAccess
    // cannot see that.
    const char = line[index]!
    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (line[index + 1] === '"') {
          field += '"'
          index++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      fields.push(field)
      field = ''
    } else {
      field += char
    }
  }
  fields.push(field)
  return fields
}

/** True for the `-----` rules that delimit tables in the statement files. */
export function isSeparator(line: string): boolean {
  const bare = jtrim(line).replace(/"/g, '')
  return bare.length > 0 && /^-+$/.test(bare)
}

/** Strip Rakuten's `(1369)` / `(AAPL)` suffix and padding from an instrument name. */
export function extractCode(nameField: string): { name: string; code: string | null } {
  const raw = jtrim(nameField)
  const nameAndCode = /^(.*?)[（(]([^（）()]+)[）)]\s*$/.exec(raw)
  if (nameAndCode) {
    return { name: jtrim(nameAndCode[1]), code: jtrim(nameAndCode[2]) }
  }
  return { name: raw, code: null }
}

/**
 * Full-width → half-width for alphanumerics.
 * The balance report writes tickers as `ＡＡＰＬ`; the trade history uses `AAPL`.
 * Both must resolve to the same instrument.
 */
export function toHalfWidth(raw: string): string {
  return (
    jtrim(raw)
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (fullWidth) =>
        String.fromCharCode(fullWidth.charCodeAt(0) - 0xfee0),
      )
      // Rakuten mixes several dash codepoints for the same character across
      // files — U+FF0D in the balance report vs U+2212 elsewhere — so instrument
      // names fail to join unless they are all folded to ASCII hyphen.
      //
      // `ー` (U+30FC) is deliberately absent from this class: it is the katakana
      // prolonged sound mark, a letter in fund names (ファンド), never a dash.
      // Folding it would corrupt every fund name that contains one.
      .replace(/[－−–—―]/g, '-')
      .replace(/　/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}
