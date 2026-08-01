/**
 * Instrument identity normalization.
 *
 * Funds carry no code in Rakuten's exports, so the name *is* the primary key —
 * which breaks when a fund is renamed or merged. Aliases fold historic names
 * onto the surviving one so a single cost-basis pool spans the change.
 */

/**
 * Historic fund name → surviving name.
 *
 * 楽天・日経225 → 楽天・プラス・日経225 (Oct 2024)
 *   Rakuten migrated holders into the cheaper 楽天・プラス series and the units
 *   moved with them. Proof from the data: the 2026-06-11 redemption of
 *   671,899 口 exactly equals 637,741 口 held under the new name plus 34,158 口
 *   held under the old one. Treated as separate instruments, that redemption
 *   oversells by 34,158 口 and the leftover position is stranded forever.
 */
const FUND_ALIASES: Readonly<Record<string, string>> = {
  '楽天・日経225インデックス・ファンド(楽天・日経225)':
    '楽天・プラス・日経225インデックス・ファンド(楽天・プラス・日経225)',
}

/** Resolve a raw instrument name/ticker to its canonical identity. */
export function canonicalSymbol(symbol: string): string {
  return FUND_ALIASES[symbol] ?? symbol
}

/** True when the name was folded onto a different instrument. */
export function isAliased(symbol: string): boolean {
  return symbol in FUND_ALIASES
}

export const fundAliases = FUND_ALIASES

/**
 * Monthly statement fund name → trade-history fund name.
 *
 * The 取引残高報告書 abbreviates fund names to fit a fixed-width field
 * (`ＭＵＡＭ純金ファンド`) while the trade history spells them out
 * (`三菱UFJ 純金ファンド(ファインゴールド)`). There is no code to join on, so
 * the mapping is explicit.
 *
 * Keys are post-`normalizeStatementName` (full-width folded, `再投資コース`
 * suffix removed).
 */
const STATEMENT_FUND_NAMES: Readonly<Record<string, string>> = {
  MUAM純金ファンド: '三菱UFJ 純金ファンド(ファインゴールド)',
  楽天P日経225: '楽天・プラス・日経225インデックス・ファンド(楽天・プラス・日経225)',
  'リソナ S-先進債IDXH': 'Smart-i 先進国債券インデックス(為替ヘッジあり)',
  ピクテITRUSTインド株: 'iTrust インド株式',
  野村INDX外株ヘッジ:
    '野村インデックスファンド・外国株式・為替ヘッジ型(Funds-i 外国株式・為替ヘッジ型)',
  'MUAM E-S全世界株': 'eMAXIS Slim 全世界株式(除く日本)',
  'MUAME-S米株SP500': 'eMAXIS Slim 米国株式(S&P500)',
  'GSテクノロジー株F B': 'netWIN GSテクノロジー株式ファンド Bコース(為替ヘッジなし)',
  KDDIAUプライム高成: 'auスマート・プライム(高成長)',
}

/**
 * Resolve a name as written in a monthly statement to the canonical instrument.
 * Returns null when unmapped, so callers can report coverage rather than
 * silently comparing nothing.
 */
export function resolveStatementFund(statementName: string): string | null {
  const mapped = STATEMENT_FUND_NAMES[statementName]
  return mapped ? canonicalSymbol(mapped) : null
}

export const statementFundNames = STATEMENT_FUND_NAMES

/**
 * Resolves an instrument as written in a monthly statement to the symbol the
 * engine keys on.
 *
 * Statements identify instruments by display name (`みずほフィナンシャルG`,
 * `GSテクノロジー株F B`) while the engine uses codes for equities (`8411`) and
 * canonical fund names for 投信. Without this bridge, dividends never match a
 * holding and silently fall back to the taxable account — which is exactly the
 * wrong default, since most of these holdings sit in NISA.
 *
 * The equity half is derived from the trade data rather than hardcoded, so it
 * stays correct as new instruments are traded.
 */
export function createStatementResolver(
  trades: { symbol: string; name: string }[],
  normalize: (s: string) => string,
): (statementName: string) => string | null {
  const byName = new Map<string, string>()
  for (const t of trades) {
    if (!t.name) continue
    byName.set(normalize(t.name).toLowerCase(), t.symbol)
  }

  return (statementName: string): string | null => {
    const normalized = normalize(statementName)
    // Funds first — their statement names are abbreviations, not prefixes.
    const fund = resolveStatementFund(normalized)
    if (fund) return fund

    const exact = byName.get(normalized.toLowerCase())
    if (exact) return exact

    // Statements truncate long names to a fixed width, so fall back to a
    // unique prefix match before giving up.
    const key = normalized.toLowerCase()
    const candidates = [...byName.entries()].filter(
      ([n]) => n.startsWith(key) || key.startsWith(n),
    )
    if (candidates.length === 1) return candidates[0]![1]
    return null
  }
}
