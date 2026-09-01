import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import styles from './calendar.module.scss'
import { NoteDialog, type NotePayload } from '~/components/calendar/NoteDialog'
import { ZeroBar } from '~/components/charts/ZeroBar'
import { tone, yenSigned } from '~/components/format'
import { HeroStat, PageHeader, StatStrip, StripCell } from '~/components/screen'
import { AccountFilterControl } from '~/components/ui/AccountFilterControl'
import { useAccountFilter } from '~/components/ui/AccountSwitch'
import { useIsMobile } from '~/components/ui/useIsMobile'
import { accountScopeSchema } from '~/lib/accountScope'
import { withNote } from '~/lib/calendarPatch'
import { cx } from '~/lib/cx'
import { thisMonthLocal } from '~/lib/localDate'
import { monthGrid, shiftMonth } from '~/lib/monthGrid'
import { removeNote, saveNote } from '~/server/notes'
import { getCalendar, type CalendarDay } from '~/server/screens'

export const Route = createFileRoute('/_authed/calendar')({
  validateSearch: z.object({
    // YYYY-MM; anything malformed falls back to the current month.
    //
    // Passed as a thunk: `.catch(value)` would evaluate the month once, when
    // this module is first imported, so a tab left open across a month boundary
    // lands on the old month whenever the sidebar link omits the param.
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .catch(() => thisMonthLocal()),
  }).extend(accountScopeSchema.shape),
  component: Calendar,
})

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MOOD_GLYPH = ['', '😞', '🙁', '😐', '🙂', '😄']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function monthLabel(month: string): string {
  const [year, monthNum] = month.split('-').map(Number)
  return `${MONTH_NAMES[(monthNum ?? 1) - 1] ?? ''} ${String(year ?? '')}`
}

function shortDayMonth(date: string): string {
  const [, monthNum, day] = date.split('-').map(Number)
  const name = MONTH_NAMES[(monthNum ?? 1) - 1] ?? ''
  return `${String(Number(day))} ${name.slice(0, 3)}`
}

/** Compact grid-cell figure — the full-width `yenSigned` doesn't fit an 84px cell. */
const shortPnl = (n: number) => (n > 0 ? '+' : '−') + '¥' + (Math.abs(n) / 1000).toFixed(1) + 'k'

/** Opacity encodes magnitude, hue encodes direction — same read at either cell size. */
function tint(pnl: number | null, peak: number): string | undefined {
  if (pnl == null || pnl === 0) return undefined
  const intensity = Math.min(Math.abs(pnl) / peak, 1)
  const token = pnl > 0 ? 'var(--color-profit)' : 'var(--color-loss)'
  return `color-mix(in srgb, ${token} ${String(10 + intensity * 40)}%, transparent)`
}

function Calendar() {
  const { month } = Route.useSearch()
  const [account, setAccount] = useAccountFilter()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const [openDay, setOpenDay] = useState<CalendarDay | null>(null)
  const isMobile = useIsMobile()

  const calendarKey = ['calendar', month, account]

  const { data: dayList, isPending } = useQuery({
    queryKey: calendarKey,
    queryFn: () => getCalendar({ data: { month, account } }),
  })

  /**
   * Apply an edit to the cached month straight away.
   *
   * A journal entry is the user's own text: the server can only store it, never
   * transform it, so there is nothing to wait for before showing it. Returns the
   * entry that was there, which is all a rollback needs — restoring a snapshot
   * of the whole month would also undo any per-trade journal saved while this
   * request was still in flight.
   */
  const patchDay = (date: string, note: CalendarDay['note']) => {
    const previous =
      queryClient.getQueryData<CalendarDay[]>(calendarKey)?.find((day) => day.date === date)
        ?.note ?? null
    queryClient.setQueryData<CalendarDay[]>(calendarKey, (days) => withNote(days, date, note))
    return previous
  }

  const save = useMutation({
    mutationFn: saveNote,
    onMutate: async ({ data }: { data: NotePayload }) => {
      // An in-flight refetch would otherwise land after this and overwrite it
      // with the pre-edit month.
      await queryClient.cancelQueries({ queryKey: calendarKey })
      setOpenDay(null)
      return {
        previous: patchDay(data.date, {
          title: data.title ?? '',
          body: data.body ?? '',
          mood: data.mood ?? null,
          motivation: data.motivation ?? null,
          tags: data.tags ?? [],
        }),
      }
    },
    onError: (_error, variables, context) => {
      patchDay(variables.data.date, context?.previous ?? null)
    },
    // Only the calendar reads journal entries. Invalidating everything refetched
    // positions, prices and tax for an edit that cannot move any of them.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  })

  const del = useMutation({
    mutationFn: (date: string) => removeNote({ data: { date } }),
    onMutate: async (date: string) => {
      await queryClient.cancelQueries({ queryKey: calendarKey })
      setOpenDay(null)
      return { previous: patchDay(date, null) }
    },
    onError: (_error, date, context) => {
      patchDay(date, context?.previous ?? null)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  })

  const goToMonth = (next: string) => {
    // Functional form: replacing the whole search object would drop `scope`, so
    // paging through months reset the account switch.
    void navigate({ search: (prev) => ({ ...prev, month: next }) })
  }

  // Drawn from the URL month, not from the response, so the squares are on
  // screen before the engine has finished replaying the history behind them.
  const { dates, leadingBlanks } = useMemo(() => monthGrid(month), [month])

  // One pass for the lookup map and every hero/strip figure. Typing in the
  // journal dialog re-renders this screen on every keystroke, and separate
  // walks of the month happened on each of them.
  const {
    byDate,
    tradedDays,
    monthPnl,
    journalled,
    peak,
    bestDay,
    worstDay,
    greenDays,
    movedDays,
    moveMaxPos,
    moveMaxNeg,
  } = useMemo(() => {
    const days = dayList ?? []
    const map = new Map<string, CalendarDay>()
    let traded = 0
    let pnl = 0
    let noted = 0
    // Scale tint by the largest absolute day so a quiet month still shows contrast.
    let largest = 1
    let green = 0
    let best: { date: string; pnl: number } | null = null
    let worst: { date: string; pnl: number } | null = null
    const moved: { date: string; pnl: number; count: number; mood: number | null }[] = []
    let maxPos = 0
    let maxNeg = 0

    for (const day of days) {
      map.set(day.date, day)
      if (day.tradeCount > 0) traded += 1
      if (day.note != null) noted += 1
      const realized = day.realizedJpy ? Number(day.realizedJpy) : 0
      pnl += realized
      largest = Math.max(largest, Math.abs(realized))

      // "Moved" = actually realized something that day — an opening trade with
      // no close yet has nothing to compare against best/worst/green.
      if (day.tradeCount > 0 && day.realizedJpy != null) {
        const value = Number(day.realizedJpy)
        if (value > 0) green += 1
        if (!best || value > best.pnl) best = { date: day.date, pnl: value }
        if (!worst || value < worst.pnl) worst = { date: day.date, pnl: value }
        moved.push({ date: day.date, pnl: value, count: day.tradeCount, mood: day.note?.mood ?? null })
        maxPos = Math.max(maxPos, value)
        maxNeg = Math.max(maxNeg, -value)
      }
    }

    return {
      byDate: map,
      tradedDays: traded,
      monthPnl: pnl,
      journalled: noted,
      peak: largest,
      bestDay: best,
      worstDay: worst,
      greenDays: green,
      movedDays: moved,
      moveMaxPos: maxPos,
      moveMaxNeg: maxNeg,
    }
  }, [dayList])

  const failed = save.isError || del.isError

  const monthNav = (
    <>
      <button
        type="button"
        className={styles.navButton}
        onClick={() => { goToMonth(shiftMonth(month, -1)) }}
        aria-label="Previous month"
      >
        ←
      </button>
      <span className={styles.monthLabel}>{month}</span>
      <button
        type="button"
        className={styles.navButton}
        onClick={() => { goToMonth(shiftMonth(month, 1)) }}
        aria-label="Next month"
      >
        →
      </button>
      <button type="button" className={styles.navButton} onClick={() => { goToMonth(thisMonthLocal()) }}>
        Today
      </button>
    </>
  )

  return (
    <>
      <PageHeader
        title="Calendar"
        meta={dayList ? `${monthLabel(month)} · ${String(tradedDays)} trading day${tradedDays === 1 ? '' : 's'}` : 'Loading…'}
      >
        <div className={styles.nav}>
          <AccountFilterControl value={account} onChange={setAccount} />
          {isMobile ? null : monthNav}
        </div>
      </PageHeader>

      {isMobile ? <div className={styles.mobileNav}>{monthNav}</div> : null}

      {failed ? (
        <p className={styles.error} role="alert">
          Could not save that journal entry — the day has been put back as it was. Please try again.
        </p>
      ) : null}

      <div className={styles.heroRow}>
        <HeroStat label="Realized this month" value={yenSigned(monthPnl)} tone={tone(monthPnl)} />
        <StatStrip>
          <StripCell
            label="Best day"
            value={bestDay ? `${yenSigned(bestDay.pnl)} · ${shortDayMonth(bestDay.date)}` : '—'}
            tone={bestDay ? tone(bestDay.pnl) : 'flat'}
          />
          <StripCell
            label="Worst day"
            value={worstDay ? `${yenSigned(worstDay.pnl)} · ${shortDayMonth(worstDay.date)}` : '—'}
            tone={worstDay ? tone(worstDay.pnl) : 'flat'}
          />
          <StripCell label="Green days" value={`${String(greenDays)} of ${String(tradedDays)}`} />
          <StripCell label="Journalled" value={String(journalled)} />
          <StripCell
            label="Avg per trading day"
            value={tradedDays > 0 ? yenSigned(monthPnl / tradedDays) : '—'}
            tone={tradedDays > 0 ? tone(monthPnl / tradedDays) : 'flat'}
          />
        </StatStrip>
      </div>

      <div
        className={cx(styles.grid, isMobile && styles.gridCompact)}
        role="grid"
        aria-label={`Trading calendar for ${month}`}
        aria-busy={isPending}
      >
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} className={styles.weekday} role="columnheader">
            {weekday}
          </div>
        ))}

        {Array.from({ length: leadingBlanks }, (_, i) => (
          // Empty grid cells offsetting the 1st to its weekday. They need no
          // styling: grid stretches them to the row height the day cells set.
          <div key={`blank-${String(i)}`} aria-hidden="true" />
        ))}

        {dates.map((date) => {
          const dayNum = Number(date.slice(-2))
          const day = byDate.get(date)

          if (isMobile) {
            return (
              <CompactDayCell
                key={date}
                date={date}
                dayNum={dayNum}
                day={day}
                peak={peak}
                onOpen={setOpenDay}
              />
            )
          }
          return (
            <FullDayCell key={date} date={date} dayNum={dayNum} day={day} peak={peak} onOpen={setOpenDay} />
          )
        })}
      </div>

      <p className={styles.legend}>
        Tint shows realized P&L for the day — green for gains, red for losses, stronger for larger.
        Click any day to journal how it felt.
      </p>

      {isMobile ? <DaysMovedList days={movedDays} maxPos={moveMaxPos} maxNeg={moveMaxNeg} /> : null}

      {openDay ? (
        <NoteDialog
          day={openDay}
          onClose={() => { setOpenDay(null) }}
          onSave={(note) => { save.mutate({ data: note }) }}
          onDelete={(date) => { del.mutate(date) }}
        />
      ) : null}
    </>
  )
}

/** PC day cell: full detail, 84px tall. */
function FullDayCell({
  date,
  dayNum,
  day,
  peak,
  onOpen,
}: {
  date: string
  dayNum: number
  day: CalendarDay | undefined
  peak: number
  onOpen: (day: CalendarDay) => void
}) {
  if (!day) {
    return (
      <div key={date} className={cx(styles.day, styles.pending)} role="gridcell" aria-label={date}>
        <span className={styles.dayNum}>{dayNum}</span>
        <span className={styles.pendingBar} aria-hidden="true" />
      </div>
    )
  }

  const pnl = day.realizedJpy == null ? null : Number(day.realizedJpy)
  const bg = tint(pnl, peak)
  const hasData = pnl != null || day.tradeCount > 0

  return (
    <button
      type="button"
      role="gridcell"
      className={cx(styles.day, day.note && styles.hasNote)}
      style={bg ? { backgroundColor: bg } : undefined}
      onClick={() => { onOpen(day) }}
      aria-label={`${day.date}${pnl != null ? `, realized ${yenSigned(pnl)}` : ''}${day.note ? ', has journal entry' : ''}`}
    >
      <span className={styles.dayTop}>
        <span className={cx(styles.dayNum, !hasData && styles.dayNumMuted)}>{dayNum}</span>
        {day.note?.mood ? (
          <span className={styles.mood} aria-hidden="true">
            {MOOD_GLYPH[day.note.mood]}
          </span>
        ) : null}
      </span>
      {hasData ? (
        <span className={styles.dayBottom}>
          {pnl != null ? (
            <span className={cx(styles.dayPnl, pnl >= 0 ? styles.profit : styles.loss)}>
              {shortPnl(pnl)}
            </span>
          ) : null}
          {day.tradeCount > 0 ? (
            <span className={styles.dayCount}>
              {day.tradeCount} trade{day.tradeCount === 1 ? '' : 's'}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  )
}

/** SP day cell: a 44px tint-and-number heat cell, detail moves to `DaysMovedList`. */
function CompactDayCell({
  date,
  dayNum,
  day,
  peak,
  onOpen,
}: {
  date: string
  dayNum: number
  day: CalendarDay | undefined
  peak: number
  onOpen: (day: CalendarDay) => void
}) {
  if (!day) {
    return (
      <div key={date} className={cx(styles.dayCompactCell, styles.pending)} role="gridcell" aria-label={date}>
        <span className={styles.dayNumMuted}>{dayNum}</span>
      </div>
    )
  }

  const pnl = day.realizedJpy == null ? null : Number(day.realizedJpy)
  const bg = tint(pnl, peak)

  return (
    <button
      type="button"
      role="gridcell"
      className={cx(styles.dayCompactCell, day.note && styles.hasNote)}
      style={bg ? { backgroundColor: bg } : undefined}
      onClick={() => { onOpen(day) }}
      aria-label={`${day.date}${pnl != null ? `, realized ${yenSigned(pnl)}` : ''}${day.note ? ', has journal entry' : ''}`}
    >
      <span className={pnl == null && day.tradeCount === 0 ? styles.dayNumMuted : undefined}>{dayNum}</span>
      {day.note ? <span className={styles.compactDot} aria-hidden="true" /> : null}
    </button>
  )
}

/** SP-only: days with a realized close, as zero-origin rows — the detail the compact grid has no room for. */
function DaysMovedList({
  days,
  maxPos,
  maxNeg,
}: {
  days: { date: string; pnl: number; count: number; mood: number | null }[]
  maxPos: number
  maxNeg: number
}) {
  if (days.length === 0) return null

  return (
    <>
      <h2 className={styles.movedTitle}>Days that moved</h2>
      <div className={styles.movedList}>
        {days.map((row) => (
          <div key={row.date} className={styles.movedRow}>
            <span className={styles.movedLabel}>{shortDayMonth(row.date)}</span>
            <span className={styles.movedMood} aria-hidden="true">
              {row.mood ? MOOD_GLYPH[row.mood] : ''}
            </span>
            <div className={styles.movedTrack}>
              <ZeroBar value={row.pnl} maxPos={maxPos} maxNeg={maxNeg} />
            </div>
            <span className={styles.movedCount}>{row.count}</span>
            <span className={cx(styles.movedValue, row.pnl >= 0 ? styles.profit : styles.loss)}>
              {yenSigned(row.pnl)}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
