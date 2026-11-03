/**
 * What may be typed into a plan's framework inputs. Client-safe: validators run
 * in the browser by design, so nothing here may reach a server-only module.
 *
 * The ranges match the framework's own stated bounds rather than being arbitrary.
 * Outside them the rule set stops behaving the way it was validated to behave.
 * Settings and a plan's own multiples share them.
 */
import Decimal from 'decimal.js'
import { z } from 'zod'
import { TRAILING_METHODS, type TrailingMethod } from './types'

/**
 * A positive decimal, as text.
 *
 * Validated rather than passed through because these land in `numeric` columns:
 * anything non-numeric would surface as a 500 from Postgres instead of a message
 * against the field that caused it.
 */
export const positiveDecimal = (label: string) =>
  z
    .string()
    .trim()
    .min(1)
    .refine((raw) => {
      try {
        const parsed = new Decimal(raw)
        return parsed.isFinite() && parsed.gt(0)
      } catch {
        return false
      }
    }, `${label} must be a positive number`)

const between = (label: string, low: string, high: string, message: string) =>
  positiveDecimal(label).refine((raw) => {
    const value = new Decimal(raw)
    return value.gte(low) && value.lte(high)
  }, message)

export const targetMultiple = between('target multiple', '1.0', '3.0', 'target multiple must be between 1.0 and 3.0')
export const initialStopAtrMultiple = between(
  'initial stop ATR multiple',
  '0.5',
  '5',
  'initial stop multiple must be between 0.5 and 5',
)

export const trailingMethod = z.enum(TRAILING_METHODS as [TrailingMethod, ...TrailingMethod[]])
