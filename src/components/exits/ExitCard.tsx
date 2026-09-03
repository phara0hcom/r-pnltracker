/**
 * One open position, read against the exit framework.
 *
 * A card rather than a table row. The framework's output is not a set of
 * comparable figures — it is a decision plus the four or five levels that
 * justify it — and a row forces those into columns where the important one
 * (what to do now) reads the same weight as the least important.
 *
 * Nothing here computes anything. Every level, every flag and the recommendation
 * itself arrive already decided from `lib/exit/rules.ts`; this file only chooses
 * how they look.
 */
import styles from './ExitCard.module.scss'
import { AccountDot } from '~/components/AccountDot'
import { ACCOUNT_LABEL, money, qty, tone } from '~/components/format'
import { InstrumentLink } from '~/components/InstrumentLink'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { cx } from '~/lib/cx'
import type { ExitRuleRow } from '~/server/exit'

/**
 * Where price sits between the initial stop and Target 1, as a 0–1 fraction.
 *
 * Used only to place the marker on the ladder. Clamped, because a position past
 * its target or through its stop is exactly when the number goes out of range
 * and exactly when the card still has to render.
 */
function ladderFraction(row: ExitRuleRow): number | null {
  if (row.currentPrice === null) return null
  const low = Number(row.initialStop)
  const high = Number(row.target1)
  if (!(high > low)) return null
  return Math.min(1, Math.max(0, (Number(row.currentPrice) - low) / (high - low)))
}

function Level({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string
  value: string
  hint?: string
  emphasis?: 'stop' | 'target' | 'live'
}) {
  return (
    <div className={styles.level}>
      <span className={styles.levelLabel}>{label}</span>
      <span
        className={cx(
          styles.levelValue,
          emphasis === 'stop' && styles.stopValue,
          emphasis === 'target' && styles.targetValue,
          emphasis === 'live' && styles.liveValue,
        )}
      >
        {value}
      </span>
      {hint ? <span className={styles.levelHint}>{hint}</span> : null}
    </div>
  )
}

export function ExitCard({
  row,
  onArchive,
  onEdit,
}: {
  row: ExitRuleRow
  onArchive: (id: string) => void
  onEdit: (row: ExitRuleRow) => void
}) {
  const fraction = ladderFraction(row)
  const unrealized = row.unrealizedTotal === null ? null : Number(row.unrealizedTotal)

  return (
    <article
      className={cx(
        styles.card,
        row.actionSeverity === 'urgent' && styles.urgent,
        row.actionSeverity === 'attention' && styles.attention,
      )}
    >
      <header className={styles.head}>
        <div className={styles.identity}>
          <InstrumentLink symbol={row.symbol} name={row.name} assetClass={row.assetClass} />
          <span className={styles.account}>
            <AccountDot accountType={row.accountType} />
            {ACCOUNT_LABEL[row.accountType] ?? row.accountType}
          </span>
        </div>

        <div className={styles.badges}>
          {row.target1Hit ? <span className={cx(styles.badge, styles.badgeHit)}>Target 1 hit</span> : null}
          {row.trailingActive ? (
            <span className={cx(styles.badge, styles.badgeTrail)}>Trail {row.trailingMethod}</span>
          ) : null}
          {row.timeStopFlag ? <span className={cx(styles.badge, styles.badgeWarn)}>Time stop</span> : null}
          {row.stale ? (
            <span className={cx(styles.badge, styles.badgeWarn)}>
              Stale {row.staleTradingDays}d
            </span>
          ) : null}
        </div>
      </header>

      {/*
        The recommendation is the whole point of the screen, so it sits above the
        figures rather than under them — the levels are the justification, not
        the headline.
      */}
      <p className={cx(styles.action, styles[row.actionSeverity])}>{row.actionMessage}</p>

      {/*
        A single axis from the initial stop to Target 1, with the effective stop
        and the last close marked on it. Decorative in the sense that every value
        is also written out below, hence aria-hidden — but it is what makes "how
        much room is left" legible without reading five numbers.
      */}
      {fraction === null ? null : (
        <div className={styles.ladder} aria-hidden="true">
          <div className={styles.ladderTrack}>
            <span
              className={styles.ladderStop}
              style={{
                left: `${String(
                  Math.min(
                    100,
                    Math.max(
                      0,
                      ((Number(row.currentStop) - Number(row.initialStop)) /
                        (Number(row.target1) - Number(row.initialStop))) *
                        100,
                    ),
                  ),
                )}%`,
              }}
            />
            <span className={styles.ladderNow} style={{ left: `${String(fraction * 100)}%` }} />
          </div>
          <div className={styles.ladderEnds}>
            <span>{money(row.initialStop, row.currency)}</span>
            <span>{money(row.target1, row.currency)}</span>
          </div>
        </div>
      )}

      <div className={styles.levels}>
        <Level
          label="Current"
          value={money(row.currentPrice, row.currency)}
          hint={row.lastBarDate ?? 'no feed'}
          emphasis="live"
        />
        <Level
          label="Effective stop"
          value={money(row.currentStop, row.currency)}
          hint={row.target1Hit ? 'breakeven or trail' : 'initial'}
          emphasis="stop"
        />
        <Level
          label="Target 1"
          value={money(row.target1, row.currency)}
          hint={row.target1HitDate ?? `${money(row.riskPerShare, row.currency)} R`}
          emphasis="target"
        />
        <Level
          label="Initial stop"
          value={money(row.initialStop, row.currency)}
          hint={row.stopFromSupportOnly ? 'support only — no entry ATR' : 'locked at entry'}
        />
        <Level
          label="Trailing stop"
          value={row.trailingStop === null ? 'Not active' : money(row.trailingStop, row.currency)}
          hint={row.trailingActive ? `high ${money(row.highestClose, row.currency)}` : 'after Target 1'}
        />
        <Level
          label="Partial size"
          value={
            Number(row.partialExitShares) === 0 ? '—' : `${qty(row.partialExitShares)} sh`
          }
          hint={row.partialTaken ? 'already taken' : `of ${qty(row.totalShares)}`}
        />
      </div>

      <footer className={styles.foot}>
        <dl className={styles.facts}>
          <div>
            <dt>Entry</dt>
            <dd>
              {money(row.entryPrice, row.currency)} · {row.entryDate}
            </dd>
          </div>
          <div>
            <dt>Shares</dt>
            <dd>
              {qty(row.sharesRemaining)} / {qty(row.totalShares)}
            </dd>
          </div>
          <div>
            <dt>Held</dt>
            <dd>
              {row.daysHeld}d · {row.tradingDaysHeld} sessions
            </dd>
          </div>
          {row.rsi14 === null ? null : (
            <div>
              <dt>RSI / MACD·h</dt>
              <dd>
                {row.rsi14} · {row.macdHist}
              </dd>
            </div>
          )}
          {unrealized === null ? null : (
            <div>
              <dt>Unrealized</dt>
              <dd className={styles[tone(row.unrealizedTotal)]}>
                {unrealized > 0 ? '+' : ''}
                {money(row.unrealizedTotal, row.currency)}
              </dd>
            </div>
          )}
        </dl>

        <div className={styles.actions}>
          <button type="button" className={styles.linkButton} onClick={() => { onEdit(row) }}>
            Edit
          </button>
          <ConfirmButton
            size="small"
            onConfirm={() => { onArchive(row.id) }}
            title="Retire this exit plan"
          >
            Archive
          </ConfirmButton>
        </div>
      </footer>

      {row.note ? <p className={styles.note}>{row.note}</p> : null}
    </article>
  )
}
