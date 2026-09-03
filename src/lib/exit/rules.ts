/**
 * The exit framework itself: stop, target, trail, time stop, and the one-line
 * recommendation that falls out of them.
 *
 * Pure, like everything under `lib/` — it takes a position, its bar history and
 * the settings, and returns an assessment. No database, no clock of its own,
 * no network. That is what lets the whole rule set be tested against handmade
 * bar sequences without standing anything up.
 *
 * The single most important design decision here is that **nothing is
 * incrementally mutated**. Highest close, whether Target 1 was reached, and the
 * ratcheting trail are all replayed from the full stored history on every call.
 * The obvious alternative — keep a running high-water mark and update it as each
 * payload lands — is wrong in a way that never heals: one bad or duplicated
 * payload permanently poisons the ratchet, and because the trail only moves up,
 * there is no subsequent observation that can correct it. Replaying means a
 * deleted or backfilled bar simply yields the right answer next time.
 */
import Decimal from 'decimal.js'
import type { AssetClass } from '../domain/types'
import { calendarFor, tradingDaysBetween } from './calendar'
import type {
  ExitAction,
  ExitAssessment,
  ExitRulePosition,
  ExitSettings,
  FeedBar,
  TrailingMethod,
} from './types'

/**
 * How far below the stop a close has to sit before the exit is reported as a
 * gap rather than an ordinary trigger.
 *
 * The feed carries no open or low — the Pine script publishes `close` only — so
 * a true opening gap is strictly unobservable here. What *is* observable is that
 * price crossed from above the stop to well below it in a single session, which
 * makes "you were filled at your stop" a bad assumption. Half an ATR is the
 * threshold for "well below": inside that, a stop order plausibly filled near
 * its level; beyond it, JP stocks routinely reopen limit-down on news and the
 * realistic fill is wherever the market next traded.
 */
const GAP_ATR_FRACTION = new Decimal('0.5')

/** Distinct RSI floor for the time stop — momentum is "fading" below the midline. */
const TIME_STOP_RSI_CEILING = new Decimal(50)

/** How many `macdHist` readings the shrinking-momentum test needs. */
const MOMENTUM_WINDOW = 5

/**
 * Rounds a share count down to whole board lots.
 *
 * 東証 trades in 100-share lots, so a suggestion of "233 shares" is not an
 * order anyone can place. Down rather than nearest, deliberately: rounding 150
 * up to 200 would sell more of the position than the framework's partial-exit
 * fraction calls for, and over-trimming a winner is the costlier mistake.
 */
export function roundDownToLot(shares: Decimal, lotSize: number): Decimal {
  if (lotSize <= 1) return shares.floor()
  const lot = new Decimal(lotSize)
  return shares.div(lot).floor().mul(lot)
}

/**
 * The initial stop, fixed at entry.
 *
 * `MIN(support, entry − k×ATR)` — whichever sits *lower*, so the stop is placed
 * outside both the structural level and normal daily noise. Taking the higher of
 * the two would put it exactly where routine volatility reaches.
 */
export function initialStopFor(
  position: ExitRulePosition,
): { stop: Decimal; fromSupportOnly: boolean } {
  if (position.entryAtr === null) {
    // No entry-date payload — usually an alert created after the position was
    // opened. Support alone still gives a usable stop, and the assessment
    // carries `stopFromSupportOnly` so the screen can say so. Substituting a
    // later ATR would be the retroactive recalculation the framework forbids.
    return { stop: position.supportLevel, fromSupportOnly: true }
  }
  // The plan's own multiple, frozen at creation — never the live setting.
  const volatilityStop = position.entryPrice.sub(
    position.entryAtr.mul(position.entryStopAtrMultiple),
  )
  return { stop: Decimal.min(position.supportLevel, volatilityStop), fromSupportOnly: false }
}

/** Which SMA a trailing method reads, or null for the ATR chandelier. */
const smaOf = (bar: FeedBar, method: TrailingMethod): Decimal | null =>
  method === 'SMA10' ? bar.sma10 : method === 'SMA20' ? bar.sma20 : null

/**
 * Strictly decreasing MACD histogram over the window.
 *
 * "Shrinking" is read as *falling values*, not falling magnitude. For a long
 * position that is the distinction that matters: a histogram going −0.5 → −0.1
 * is momentum recovering, and testing |h| would have flagged it as fading and
 * closed the trade into a turn.
 */
function momentumShrinking(history: Decimal[]): boolean {
  if (history.length < MOMENTUM_WINDOW) return false
  const window = history.slice(-MOMENTUM_WINDOW)
  return window.every((value, index) => {
    const earlier = window[index - 1]
    return earlier === undefined || value.lt(earlier)
  })
}

const money = (value: Decimal, assetClass: AssetClass): string =>
  assetClass === 'US_EQUITY'
    ? `$${value.toDecimalPlaces(2).toFixed(2)}`
    : `¥${value.toDecimalPlaces(0).toNumber().toLocaleString('en-US')}`

const shares = (value: Decimal): string => value.toNumber().toLocaleString('en-US')

/**
 * Replays the bar history into the path-dependent state.
 *
 * Bars are assumed pre-filtered to the position's holding period and sorted
 * ascending; `assess` guarantees both.
 */
function replay(
  bars: FeedBar[],
  target1: Decimal,
  settings: ExitSettings,
  method: TrailingMethod,
) {
  let highestClose: Decimal | null = null
  let target1Hit = false
  let target1HitDate: string | null = null
  let trailingStop: Decimal | null = null
  let previous: FeedBar | null = null
  const histogram: Decimal[] = []

  for (const bar of bars) {
    highestClose = highestClose === null ? bar.close : Decimal.max(highestClose, bar.close)

    if (!target1Hit && bar.close.gte(target1)) {
      target1Hit = true
      target1HitDate = bar.tradingDay
    }

    // The trail does not run before Target 1 — until then the initial stop is
    // the only stop, and letting the chandelier tighten early would cut trades
    // short of the level the position was sized for.
    if (target1Hit) {
      const sma = smaOf(bar, method)
      let candidate: Decimal | null = null

      if (sma === null) {
        candidate = highestClose.sub(bar.atr14.mul(settings.trailingAtrMultiple))
      } else if (previous !== null) {
        // A moving average only counts as a trail while it is itself rising.
        // A flat or falling MA is not support, and following one down would
        // hand back gains the ratchet exists to protect.
        const previousSma = smaOf(previous, method)
        if (previousSma !== null && sma.gt(previousSma)) candidate = sma
      }

      // Ratchet: up only, ever. `Decimal.max` against the stored value is the
      // whole mechanism — a wider stop computed on a quieter day never loosens
      // one already earned.
      if (candidate !== null) {
        trailingStop = trailingStop === null ? candidate : Decimal.max(trailingStop, candidate)
      }
    }

    histogram.push(bar.macdHist)
    previous = bar
  }

  return {
    highestClose,
    target1Hit,
    target1HitDate,
    trailingStop,
    histogram,
    latestBar: previous,
    priorBar: bars.at(-2) ?? null,
  }
}

/**
 * Evaluates one position against the whole rule set.
 *
 * `bars` may be the instrument's entire stored history — bars before entry are
 * dropped here rather than at the call site, so no caller can accidentally let
 * a pre-entry high seed the trailing stop.
 *
 * `today` must be the current date **in the exchange's timezone**, which is the
 * zone every `tradingDay` is stored in. Passing the server's own calendar date
 * would compare dates from two zones and skew both the staleness count and the
 * time stop by a session. Use `todayFor(calendarFor(assetClass))`.
 */
export function assess(
  position: ExitRulePosition,
  bars: FeedBar[],
  settings: ExitSettings,
  today: string,
): ExitAssessment {
  const calendar = calendarFor(position.assetClass)
  const method = position.trailingMethod ?? settings.trailingMethod

  const history = bars
    .filter((bar) => bar.tradingDay >= position.entryDate)
    .sort((left, right) => (left.tradingDay < right.tradingDay ? -1 : 1))

  const { stop: initialStop, fromSupportOnly } = initialStopFor(position)
  const riskPerShare = position.entryPrice.sub(initialStop)
  // Locked multiples, so changing the global setting reprices new plans only.
  const target1 = position.entryPrice.add(riskPerShare.mul(position.entryTargetMultiple))
  const partialExitShares = roundDownToLot(
    position.totalShares.mul(settings.partialExitFraction),
    position.lotSize,
  )

  const state = replay(history, target1, settings, method)
  const { latestBar, priorBar } = state

  const partialTaken = position.sharesSold.gt(0)
  const trailingActive = state.target1Hit && state.trailingStop !== null

  // Before Target 1 the initial stop stands alone. After it, breakeven is the
  // floor — the framework's core promise is that a trade that reached its first
  // target never becomes a loser — and the trail can only improve on it.
  const currentStop = state.target1Hit
    ? Decimal.max(position.entryPrice, state.trailingStop ?? position.entryPrice)
    : initialStop

  const daysHeld = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${position.entryDate}T00:00:00Z`)) / 86_400_000,
  )
  const tradingDaysHeld = tradingDaysBetween(position.entryDate, today, calendar)

  const timeStopFlag =
    !state.target1Hit &&
    tradingDaysHeld > settings.timeStopDays &&
    momentumShrinking(state.histogram) &&
    (latestBar?.rsi14.lt(TIME_STOP_RSI_CEILING) ?? false)

  // Measured from the last bar received, not from entry: a feed that has been
  // healthy all along and stopped yesterday is the case worth catching, and it
  // is invisible if staleness is measured over the whole holding period.
  const staleDays =
    latestBar === null
      ? tradingDaysBetween(position.entryDate, today, calendar)
      : tradingDaysBetween(latestBar.tradingDay, today, calendar)
  const stale = staleDays > settings.staleTradingDays

  const stoppedOut = latestBar?.close.lte(currentStop) ?? false
  const gapped =
    stoppedOut &&
    latestBar !== null &&
    priorBar !== null &&
    priorBar.close.gt(currentStop) &&
    latestBar.close.lt(currentStop.sub(latestBar.atr14.mul(GAP_ATR_FRACTION)))

  const action = decideAction({
    position,
    settings,
    partialTaken,
    partialExitShares,
    target1,
    target1Hit: state.target1Hit,
    target1HitDate: state.target1HitDate,
    trailingActive,
    trailingStop: state.trailingStop,
    currentStop,
    latestBar,
    stoppedOut,
    gapped,
    stale,
    staleDays,
    timeStopFlag,
  })

  return {
    initialStop,
    riskPerShare,
    target1,
    partialExitShares,
    target1Hit: state.target1Hit,
    target1HitDate: state.target1HitDate,
    partialTaken,
    highestClose: state.highestClose,
    trailingStop: state.trailingStop,
    trailingActive,
    trailingMethod: method,
    currentStop,
    latestBar,
    daysHeld,
    tradingDaysHeld,
    timeStopFlag,
    stale,
    staleTradingDays: staleDays,
    stopFromSupportOnly: fromSupportOnly,
    unrealizedPerShare: latestBar === null ? null : latestBar.close.sub(position.entryPrice),
    action,
  }
}

interface ActionInput {
  position: ExitRulePosition
  settings: ExitSettings
  partialTaken: boolean
  partialExitShares: Decimal
  target1: Decimal
  target1Hit: boolean
  target1HitDate: string | null
  trailingActive: boolean
  trailingStop: Decimal | null
  currentStop: Decimal
  latestBar: FeedBar | null
  stoppedOut: boolean
  gapped: boolean
  stale: boolean
  staleDays: number
  timeStopFlag: boolean
}

/**
 * Picks the single recommendation, most urgent first.
 *
 * Order matters and is the point of the function: a stopped-out position must
 * not also be told to "hold", and a stale feed must not be mistaken for calm.
 *
 * A stop-out outranks staleness even though the reading may be days old —
 * knowing the last observed close was already through the stop is more
 * actionable than knowing the feed is quiet, and `stale` stays set on the
 * assessment either way so the screen can badge both at once.
 */
function decideAction(input: ActionInput): ExitAction {
  const { position, latestBar, currentStop } = input
  const asMoney = (value: Decimal) => money(value, position.assetClass)

  if (position.sharesRemaining.lte(0)) {
    return {
      kind: 'POSITION_CLOSED',
      message: 'Position closed — no shares remaining. Archive this rule.',
      severity: 'neutral',
    }
  }

  if (latestBar === null) {
    return {
      kind: 'AWAITING_FEED',
      message: 'Data stale — no webhook payload received yet. Check the TradingView alert.',
      severity: 'attention',
    }
  }

  if (input.stoppedOut) {
    return input.gapped
      ? {
          kind: 'STOPPED_OUT_GAP',
          message: `Stopped out — gap. Close ${asMoney(latestBar.close)} is well below the ${asMoney(currentStop)} stop, so assume a fill at market, not at the stop.`,
          severity: 'urgent',
        }
      : {
          kind: 'STOPPED_OUT',
          message: `Stopped out — close ${asMoney(latestBar.close)} is at or below the ${asMoney(currentStop)} stop. Exit the remaining ${shares(position.sharesRemaining)} shares.`,
          severity: 'urgent',
        }
  }

  if (input.stale) {
    return {
      kind: 'DATA_STALE',
      message: `Data stale — no payload for ${String(input.staleDays)} trading days. The TradingView alert has probably expired (Plus plan alerts lapse after 2 months).`,
      severity: 'attention',
    }
  }

  if (input.target1Hit && !input.partialTaken) {
    // A single board lot cannot be halved. Saying so is more useful than
    // suggesting a zero-share sale, which is what the rounding produces.
    if (input.partialExitShares.lte(0)) {
      return {
        kind: 'TAKE_PARTIAL',
        message: `Target 1 reached at ${asMoney(latestBar.close)}, but the position is a single lot — no partial is possible. Exit in full or hold the remainder against the trail.`,
        severity: 'attention',
      }
    }
    // Target 1 is latched, so the current close may have fallen back below it.
    // Stating "close ≥ Target 1" unconditionally printed a comparison that was
    // plainly false on any pullback after a target touch, in a message the card
    // renders verbatim.
    const reached = latestBar.close.gte(input.target1)
    return {
      kind: 'TAKE_PARTIAL',
      message: reached
        ? `Take partial profit — sell ${shares(input.partialExitShares)} shares now (close ${asMoney(latestBar.close)} ≥ Target 1 ${asMoney(input.target1)}).`
        : `Take partial profit — sell ${shares(input.partialExitShares)} shares. Target 1 ${asMoney(input.target1)} was reached${input.target1HitDate === null ? '' : ` on ${input.target1HitDate}`}; price has since eased to ${asMoney(latestBar.close)}.`,
      severity: 'attention',
    }
  }

  if (input.target1Hit && input.trailingActive && input.trailingStop !== null) {
    if (input.trailingStop.gt(position.entryPrice)) {
      return {
        kind: 'TRAIL_ACTIVE',
        message: `Trail active — stop now at ${asMoney(input.trailingStop)}, above breakeven. Hold the remaining ${shares(position.sharesRemaining)} shares.`,
        severity: 'neutral',
      }
    }
  }

  if (input.target1Hit) {
    return {
      kind: 'MOVE_TO_BREAKEVEN',
      message: `Move stop to breakeven — ${asMoney(position.entryPrice)}. Target 1 is in and the trail has not yet cleared entry.`,
      severity: 'attention',
    }
  }

  if (input.timeStopFlag) {
    return {
      kind: 'TIME_STOP',
      message: `Time stop — review. ${String(input.settings.timeStopDays)}+ trading days without reaching Target 1, MACD histogram shrinking and RSI ${latestBar.rsi14.toDecimalPlaces(1).toFixed(1)} below 50.`,
      severity: 'attention',
    }
  }

  return {
    kind: 'HOLD',
    message: `Hold — close ${asMoney(latestBar.close)} is between the ${asMoney(currentStop)} stop and Target 1.`,
    severity: 'neutral',
  }
}
