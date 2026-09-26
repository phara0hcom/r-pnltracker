/**
 * The month as rows of weeks.
 *
 * Drawn from the URL month alone, so the squares are on screen before the
 * engine has replayed the history behind them, and the figures fill in.
 *
 * PC: each day with its figures, and each week's total at the end of its row.
 * SP: each day as a compact square — its number and its yen, shortened — with
 * the detail in the day-by-day list under the grid.
 *
 * Weekends keep their full width. A settled US fill is dated by the JST day it
 * executed on, so Friday's session on Wall Street lands on Saturday here.
 */
import styles from './CalendarGrid.module.scss'
import { dayAriaLabel, dayFigures, rangeLabel, tradesLabel, WEEKDAYS } from './dayText'
import { MoodFace } from './MoodFace'
import { tone, yenCompact, yenSigned } from '~/components/format'
import { cx } from '~/lib/cx'
import { monthWeeks } from '~/lib/monthGrid'
import type { CalendarDay, CalendarWeek } from '~/server/screens'

/**
 * Opacity encodes magnitude, hue encodes direction — the same read at either
 * cell size. Scaled to the month's largest day, so a quiet month still shows
 * contrast; the figures on top stay near-white, legible on the strongest tint.
 */
export function dayTint(realizedJpy: string | null, peak: number): string | undefined {
  const value = realizedJpy == null ? 0 : Number(realizedJpy)
  if (value === 0 || peak <= 0) return undefined
  const strength = 12 + 43 * Math.min(Math.abs(value) / peak, 1)
  const token = value > 0 ? 'var(--color-profit)' : 'var(--color-loss)'
  return `color-mix(in srgb, ${token} ${strength.toFixed(1)}%, transparent)`
}

const isWeekend = (column: number) => column >= 5

function Blank() {
  return <div role="gridcell" aria-hidden="true" className={styles.blank} />
}

/** A dated square before its figures have arrived. */
function PendingDay({ date, compact }: { date: string; compact: boolean }) {
  return (
    <div role="gridcell" aria-label={date} className={cx(styles.day, compact && styles.compact, styles.pending)}>
      <span className={cx(styles.num, styles.numMuted)}>{Number(date.slice(-2))}</span>
      {compact ? null : <span className={styles.pendingBar} aria-hidden="true" />}
    </div>
  )
}

function DayCell({
  day,
  column,
  peak,
  isToday,
  compact,
  onOpen,
}: {
  day: CalendarDay
  column: number
  peak: number
  isToday: boolean
  compact: boolean
  onOpen: (date: string) => void
}) {
  const tint = dayTint(day.realizedJpy, peak)
  const active = day.tradeCount > 0 || day.note != null
  const figures = dayFigures(day.markets)
  const count = tradesLabel(day)

  return (
    <button
      type="button"
      role="gridcell"
      className={cx(
        styles.day,
        compact && styles.compact,
        isWeekend(column) && styles.weekend,
        tint != null && styles.tinted,
        isToday && styles.today,
      )}
      style={tint ? { backgroundColor: tint } : undefined}
      onClick={() => {
        onOpen(day.date)
      }}
      aria-label={dayAriaLabel(day, isToday)}
    >
      <span className={styles.top}>
        <span className={cx(styles.num, !active && styles.numMuted)}>{Number(day.date.slice(-2))}</span>
        {compact ? null : isToday ? <span className={styles.todayTag}>Today</span> : null}
        {day.note == null ? null : compact || !day.note.mood ? (
          <span className={styles.noteDot} aria-hidden="true" />
        ) : (
          <MoodFace mood={day.note.mood} className={styles.mood} />
        )}
      </span>
      {compact ? (
        day.realizedJpy == null ? null : (
          <span className={styles.compactFigure}>{yenCompact(day.realizedJpy)}</span>
        )
      ) : figures.length > 0 || count ? (
        <span className={styles.bottom}>
          {figures.map((figure) => (
            <span key={figure.key} className={styles.figure}>
              <span className={styles.full}>{figure.full}</span>
              <span className={styles.short}>{figure.short}</span>
            </span>
          ))}
          {count ? <span className={styles.count}>{count}</span> : null}
        </span>
      ) : null}
    </button>
  )
}

/** The week's total at the end of its row: yen, the currency move included. */
function WeekCell({ dates, week }: { dates: string[]; week: CalendarWeek | undefined }) {
  const from = dates[0] ?? ''
  const to = dates.at(-1) ?? from
  const label = rangeLabel(from, to)
  if (!week) {
    return (
      <div role="gridcell" aria-label={`Week of ${label}`} className={cx(styles.week, styles.pending)}>
        <span className={styles.weekRange}>{label}</span>
        <span className={styles.pendingBar} aria-hidden="true" />
      </div>
    )
  }
  const total = week.markets?.totalJpy ?? null
  const tint = tone(total)
  const trades = week.tradeCount === 0 ? 'No trades' : `${String(week.tradeCount)} trade${week.tradeCount === 1 ? '' : 's'}`

  return (
    <div
      role="gridcell"
      className={styles.week}
      aria-label={`Week of ${label}: ${total == null ? 'nothing realized' : `realized ${yenSigned(total)}`}, ${trades.toLowerCase()}`}
    >
      <span className={styles.weekRange}>{label}</span>
      <span className={styles.bottom}>
        <span
          className={cx(styles.weekTotal, tint === 'profit' && styles.profit, tint === 'loss' && styles.loss)}
        >
          <span className={styles.full}>{total == null ? '—' : yenSigned(total)}</span>
          <span className={styles.short}>{total == null ? '—' : yenCompact(total)}</span>
        </span>
        <span className={styles.weekCount}>{trades}</span>
      </span>
    </div>
  )
}

export function CalendarGrid({
  month,
  label,
  days,
  weeks,
  peak,
  today,
  compact,
  onOpen,
}: {
  month: string
  /** Names the grid for a screen reader, e.g. "Trading calendar for September 2026". */
  label: string
  /** Null until the month's figures arrive. */
  days: ReadonlyMap<string, CalendarDay> | null
  weeks: readonly CalendarWeek[] | null
  peak: number
  today: string | null
  compact: boolean
  onOpen: (date: string) => void
}) {
  const rows = monthWeeks(month)
  const byFrom = new Map(weeks?.map((week) => [week.from, week]))

  return (
    <div
      role="grid"
      aria-label={label}
      aria-busy={days == null}
      className={cx(styles.grid, compact && styles.gridCompact)}
    >
      <div role="row" className={styles.row}>
        {WEEKDAYS.map((weekday, column) => (
          <span
            key={weekday}
            role="columnheader"
            className={cx(styles.head, isWeekend(column) && styles.headWeekend)}
          >
            {weekday}
          </span>
        ))}
        {compact ? null : (
          <span role="columnheader" className={styles.head}>
            Week
          </span>
        )}
      </div>

      {rows.map((dates, index) => {
        // The first week is short at its start, the last at its end.
        const blanks = 7 - dates.length
        const leading = index === 0 ? blanks : 0
        return (
          <div key={dates[0]} role="row" className={styles.row}>
            {Array.from({ length: leading }, (_, blank) => (
              <Blank key={`lead-${String(blank)}`} />
            ))}
            {dates.map((date, offset) => {
              const day = days?.get(date)
              if (!day) return <PendingDay key={date} date={date} compact={compact} />
              return (
                <DayCell
                  key={date}
                  day={day}
                  column={leading + offset}
                  peak={peak}
                  isToday={date === today}
                  compact={compact}
                  onOpen={onOpen}
                />
              )
            })}
            {Array.from({ length: blanks - leading }, (_, blank) => (
              <Blank key={`trail-${String(blank)}`} />
            ))}
            {compact ? null : <WeekCell dates={dates} week={days ? byFrom.get(dates[0] ?? '') : undefined} />}
          </div>
        )
      })}
    </div>
  )
}
