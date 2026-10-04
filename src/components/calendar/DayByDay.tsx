/**
 * SP: the days with a trade, week by week — the detail the compact squares
 * have no room for. Each row opens its day, as the square does.
 *
 * A week's heading carries its total, so the phone gets the week column the
 * desktop grid has without the grid losing a column to it.
 */
import styles from './DayByDay.module.scss'
import { dayAriaLabel, dayFigures, rangeLabel, tradesLabel, weekdayOf } from './dayText'
import { MoodFace } from './MoodFace'
import { ZeroBar } from '~/components/charts/ZeroBar'
import { tone, yenSigned } from '~/components/format'
import { cx } from '~/lib/cx'
import type { CalendarDay, CalendarWeek } from '~/server/screens'

function Chevron() {
  return (
    <svg className={styles.chevron} width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function DayByDay({
  weeks,
  days,
  today,
  onOpen,
}: {
  weeks: readonly CalendarWeek[]
  days: ReadonlyMap<string, CalendarDay>
  today: string | null
  onOpen: (date: string) => void
}) {
  const traded = [...days.values()].filter((day) => day.tradeCount > 0)
  if (traded.length === 0) return null

  // One scale for the whole month, so a bar compares across weeks too.
  let maxPos = 0
  let maxNeg = 0
  for (const day of traded) {
    const value = Number(day.realizedJpy ?? 0)
    maxPos = Math.max(maxPos, value)
    maxNeg = Math.max(maxNeg, -value)
  }

  return (
    <section className={styles.root} aria-labelledby="day-by-day">
      <h2 id="day-by-day" className={styles.title}>
        Day by day
      </h2>
      {weeks.map((week) => {
        const list = traded.filter((day) => day.date >= week.from && day.date <= week.to)
        if (list.length === 0) return null
        const total = week.markets?.totalJpy ?? null
        const weekTone = tone(total)
        return (
          <div key={week.from} className={styles.week}>
            <div className={styles.weekHead}>
              <span className={styles.weekRange}>{rangeLabel(week.from, week.to)}</span>
              <span className={styles.weekFigures}>
                <span className={cx(styles.weekTotal, weekTone === 'profit' && styles.profit, weekTone === 'loss' && styles.loss)}>
                  {total == null ? '—' : yenSigned(total)}
                </span>
                <span className={styles.weekCount}>
                  · {week.tradeCount} trade{week.tradeCount === 1 ? '' : 's'}
                </span>
              </span>
            </div>
            <ul className={styles.list}>
              {list.map((day) => {
                const figures = dayFigures(day.markets)
                return (
                  <li key={day.date}>
                    <button
                      type="button"
                      className={styles.row}
                      onClick={() => {
                        onOpen(day.date)
                      }}
                      aria-label={dayAriaLabel(day, day.date === today)}
                    >
                      <span className={styles.date}>
                        <span className={styles.dayNum}>{Number(day.date.slice(-2))}</span>
                        <span className={styles.weekday}>{weekdayOf(day.date)}</span>
                      </span>
                      <span className={styles.mood}>
                        {day.note == null ? null : day.note.mood ? (
                          <MoodFace mood={day.note.mood} />
                        ) : (
                          <span className={styles.noteDot} />
                        )}
                      </span>
                      <span className={styles.middle}>
                        <span className={styles.count}>{tradesLabel(day)}</span>
                        <ZeroBar value={Number(day.realizedJpy ?? 0)} maxPos={maxPos} maxNeg={maxNeg} size="compact" />
                      </span>
                      <span className={styles.figures}>
                        {figures.length === 0 ? (
                          <span className={styles.none}>—</span>
                        ) : (
                          figures.map((figure) => {
                            const figureTone = tone(figure.value)
                            return (
                              <span
                                key={figure.key}
                                className={cx(figureTone === 'profit' && styles.profit, figureTone === 'loss' && styles.loss)}
                              >
                                {figure.full}
                              </span>
                            )
                          })
                        )}
                      </span>
                      <Chevron />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
