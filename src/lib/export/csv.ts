/**
 * CSV assembly, shared by every export.
 *
 * The quoting rules are the whole reason this is one module rather than a line
 * inlined per export: instrument names are free text from a Rakuten export and
 * carry commas, parentheses and the occasional quote — `eMAXIS Slim
 * 米国株式(S&P500)` is one row among many. An unquoted comma silently shifts
 * every later column, and a file that is wrong in that way still opens.
 */

/** RFC 4180 specifies CRLF; Excel prefers it, Numbers and Sheets accept it. */
const CRLF = '\r\n'

/** RFC 4180 quoting: wrap when the field holds a delimiter, and double any quote. */
function escapeCsvField(field: string): string {
  return /["\r\n,]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field
}

/**
 * Whether to lead with a UTF-8 byte-order mark.
 *
 * It is not a stylistic choice — it depends on who opens the file:
 *
 * - a human, in Excel: **required**. Excel reads a BOM-less UTF-8 CSV as the
 *   system legacy encoding, turning every Japanese name into mojibake.
 * - a machine, parsing headers: **harmful**. The BOM becomes part of the first
 *   header cell, so `Symbol` arrives as `\uFEFFSymbol` and stops matching.
 */
export type CsvEncoding = 'excel' | 'plain'

const BOM = '\uFEFF'

/** Rows of already-stringified cells — header included — into one CSV document. */
export function csvDocument(rows: readonly (readonly string[])[], encoding: CsvEncoding): string {
  const body = rows.map((cells) => cells.map(escapeCsvField).join(',')).join(CRLF)
  return (encoding === 'excel' ? BOM : '') + body + CRLF
}
