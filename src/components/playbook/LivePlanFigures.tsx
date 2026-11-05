/**
 * A live plan's levels and facts, in full.
 *
 * The last of what the Exit Rules screen showed moved here with it: the trailing
 * stop, the size of the partial, the shares left, the unrealized figure, RSI and
 * MACD, and the plan's note. They are what the recommendation above them is
 * justified by, and with that screen gone this is the only place to read them.
 *
 * Nothing here computes; every figure arrives decided from `lib/exit/rules.ts`.
 */
import { Figure, figureStyles } from './Figure'
import { METHOD_LABEL } from './PlanFields'
import { moneySigned, priceText, qty, tone } from '~/components/format'
import type { ExitRuleRow } from '~/server/exitPosition'

export function LivePlanFigures({
  row,
  stopMultiple,
  targetMultiple,
  target1Manual,
  children,
}: {
  row: ExitRuleRow
  stopMultiple: string
  targetMultiple: string
  target1Manual: boolean
  /** Anything further to list among the figures: the extra targets. */
  children?: React.ReactNode
}) {
  const { currency } = row
  const target1Basis = target1Manual ? 'manual' : `auto · ${targetMultiple} × R`
  const unrealizedTone = tone(row.unrealizedTotal)
  return (
    <>
      <div className={figureStyles.figures}>
        <Figure label="Entry" value={priceText(row.entryPrice, currency)} hint={row.entryDate} />
        <Figure label="Support" value={priceText(row.supportLevel, currency)} />
        <Figure
          label="Initial stop"
          value={priceText(row.initialStop, currency)}
          hint={row.stopFromSupportOnly ? 'support only — no entry ATR' : `locked · ${stopMultiple} × ATR`}
        />
        <Figure label="R" value={priceText(row.riskPerShare, currency)} hint="per share" />
        <Figure
          label="Target 1"
          value={priceText(row.target1, currency)}
          hint={row.target1HitDate ? `hit ${row.target1HitDate} · ${target1Basis}` : target1Basis}
        />
        <Figure
          label="Effective stop"
          value={priceText(row.currentStop, currency)}
          hint={row.target1Hit ? 'breakeven or trail' : 'initial'}
        />
        <Figure label="Trail" value={METHOD_LABEL[row.trailingMethod]} hint={row.trailingActive ? 'active' : 'after Target 1'} />
        <Figure
          label="Trailing stop"
          value={row.trailingStop === null ? 'Not active' : priceText(row.trailingStop, currency)}
          hint={row.trailingActive ? `high ${priceText(row.highestClose, currency)}` : undefined}
        />
        <Figure
          label="Partial size"
          value={Number(row.partialExitShares) === 0 ? '—' : `${qty(row.partialExitShares)} sh`}
          hint={row.partialTaken ? 'already taken' : `of ${qty(row.totalShares)}`}
        />
        <Figure label="Shares" value={`${qty(row.sharesRemaining)} / ${qty(row.totalShares)}`} hint="left / entered" />
        <Figure label="Last close" value={priceText(row.currentPrice, currency)} hint={row.lastBarDate ?? 'no feed yet'} />
        {row.unrealizedTotal === null ? null : (
          <Figure
            label="Unrealized"
            value={
              <span className={unrealizedTone === 'flat' ? undefined : figureStyles[unrealizedTone]}>
                {moneySigned(row.unrealizedTotal, currency)}
              </span>
            }
          />
        )}
        <Figure label="Held" value={`${String(row.daysHeld)}d · ${String(row.tradingDaysHeld)} sessions`} />
        {row.rsi14 === null ? null : <Figure label="RSI / MACD·h" value={`${row.rsi14} · ${row.macdHist ?? '—'}`} />}
        {children}
      </div>
      {row.note ? <p className={figureStyles.note}>{row.note}</p> : null}
    </>
  )
}
