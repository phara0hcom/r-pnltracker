/**
 * Shift-JIS decoding, deliberately alone in its own module.
 *
 * `iconv-lite` is CommonJS and builds its DBCS/SBCS encoding tables at load
 * time, touching `Buffer.prototype` as it does. Rollup keeps a module's
 * top-level side effects even when none of its exports are used, so any client
 * module that transitively imports this one ships ~300 KB of encoding tables to
 * the browser and then throws on `Buffer` — which is not defined there.
 *
 * That is exactly what happened while this lived in `util.ts`: a server
 * function's `.validator()` legitimately runs on the client, it pulled in
 * `util.ts` for `toYen`, and the whole app failed to boot. Keeping the only
 * `iconv-lite` import here means the pure helpers stay safe to reach from
 * anywhere.
 */
import iconv from 'iconv-lite'

/** Rakuten writes Shift-JIS. Files are small, so decode eagerly. */
export function decodeShiftJis(buf: Buffer | Uint8Array): string {
  return iconv.decode(Buffer.from(buf), 'Shift_JIS')
}
