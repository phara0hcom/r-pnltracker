/**
 * A price as stored, against the same price as quoted.
 *
 * A fund is stored per single 口, because that is what the engine multiplies a
 * holding's 口 by. It is quoted per 10,000 口, as the 基準価額 that Rakuten and
 * every fund house publish. Anything else is quoted in the unit it is stored in.
 *
 * Every screen that shows a fund's price, or takes one typed in, converts here:
 * Positions, the calendar, Trades and its forms, the import preview, Settings.
 * Only the CSV parsers divide on their own, as a file is read. Settings once
 * took the stored unit while Positions showed the quoted one, so a 基準価額
 * copied from Rakuten valued the fund 10,000 times too high.
 */
import Decimal from 'decimal.js'
import { FUND_UNIT_DIVISOR, type AssetClass } from '../domain/types'

/** The stored price in the unit it is quoted in. */
export const quotedPrice = (stored: Decimal.Value, assetClass: AssetClass): Decimal =>
  assetClass === 'FUND' ? new Decimal(stored).mul(FUND_UNIT_DIVISOR) : new Decimal(stored)

/** A quoted price, such as one typed into Settings, in the unit it is stored in. */
export const storedPrice = (quoted: Decimal.Value, assetClass: AssetClass): Decimal =>
  assetClass === 'FUND' ? new Decimal(quoted).div(FUND_UNIT_DIVISOR) : new Decimal(quoted)
