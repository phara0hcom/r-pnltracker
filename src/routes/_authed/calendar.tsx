import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import styles from './calendar.module.scss'
import { NoteDialog, type NotePayload } from '~/components/calendar/NoteDialog'
import { tone, yenSigned } from '~/components/format'
import { PageHeader } from '~/components/screen'
import { AccountSwitch, useAccountFilter } from '~/components/ui/AccountSwitch'
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

function Calendar() {
  const { month } = Route.useSearch()
  const [account, setAccount] = useAccountFilter()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const [openDay, setOpenDay] = useState<CalendarDay | null>(null)

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

  // One pass for the lookup map and all four summary figures. Typing in the
  // journal dialog re-renders this screen on every keystroke, and five separate
  // walks of the month happened on each of them.
  const { byDate, tradedDays, monthPnl, journalled, peak } = useMemo(() => {
    const days = dayList ?? []
    const map = new Map<string, CalendarDay>()
    let traded = 0
    let pnl = 0
    let noted = 0
    // Scale tint by the largest absolute day so a quiet month still shows contrast.
    let largest = 1

    for (const day of days) {
      map.set(day.date, day)
      if (day.tradeCount > 0) traded += 1
      if (day.note != null) noted += 1
      const realized = day.realizedJpy ? Number(day.realizedJpy) : 0
      pnl += realized
      largest = Math.max(largest, Math.abs(realized))
    }

    return { byDate: map, tradedDays: traded, monthPnl: pnl, journalled: noted, peak: largest }
  }, [dayList])

  const failed = save.isError || del.isError

  return (
    <>
      <PageHeader
        title="Calendar"
        meta={
          dayList ? (
            <>
              {tradedDays} trading day{tradedDays === 1 ? '' : 's'} ·{' '}
              <span className={tone(monthPnl) === 'profit' ? styles.profit : tone(monthPnl) === 'loss' ? styles.loss : ''}>
                {yenSigned(monthPnl)}
              </span>{' '}
              · {journalled} journalled
            </>
          ) : (
            'Loading…'
          )
        }
      >
        <div className={styles.nav}>
          <AccountSwitch value={account} onChange={setAccount} />
          <button type="button" className={styles.navButton} onClick={() => { goToMonth(shiftMonth(month, -1)) }} aria-label="Previous month">
            ←
          </button>
          <span className={styles.monthLabel}>{month}</span>
          <button type="button" className={styles.navButton} onClick={() => { goToMonth(shiftMonth(month, 1)) }} aria-label="Next month">
            →
          </button>
          <button
            type="button"
            className={styles.navButton}
            onClick={() => { goToMonth(thisMonthLocal()) }}
          >
            Today
          </button>
        </div>
      </PageHeader>

      {failed ? (
        <p className={styles.error} role="alert">
          Could not save that journal entry — the day has been put back as it was. Please try again.
        </p>
      ) : null}

      <div
        className={styles.grid}
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
          <div key={`blank-${String(i)}`} className={styles.blank} aria-hidden="true" />
        ))}

        {dates.map((date) => {
          const dayNum = Number(date.slice(-2))
          const day = byDate.get(date)

          // Dated but not yet filled in. Not a button: there is nothing to open
          // until the day's trades and note have arrived.
          if (!day) {
            return (
              <div key={date} className={cx(styles.day, styles.pending)} role="gridcell" aria-label={date}>
                <span className={styles.dayNum}>{dayNum}</span>
                <span className={styles.pendingBar} aria-hidden="true" />
              </div>
            )
          }

          const pnl = day.realizedJpy == null ? null : Number(day.realizedJpy)
          // Opacity encodes magnitude; hue encodes direction.
          const intensity = pnl == null ? 0 : Math.min(Math.abs(pnl) / peak, 1)
          const bg =
            pnl == null || pnl === 0
              ? undefined
              : pnl > 0
                ? `color-mix(in srgb, var(--color-profit) ${String(12 + intensity * 45)}%, transparent)`
                : `color-mix(in srgb, var(--color-loss) ${String(12 + intensity * 45)}%, transparent)`

          return (
            <button
              key={day.date}
              type="button"
              role="gridcell"
              className={cx(styles.day, day.note && styles.hasNote)}
              style={bg ? { backgroundColor: bg } : undefined}
              onClick={() => { setOpenDay(day) }}
              aria-label={`${day.date}${pnl != null ? `, realized ${yenSigned(pnl)}` : ''}${day.note ? ', has journal entry' : ''}`}
            >
              <span className={styles.dayNum}>{dayNum}</span>
              {day.note?.mood ? (
                <span className={styles.mood} aria-hidden="true">
                  {MOOD_GLYPH[day.note.mood]}
                </span>
              ) : null}
              {pnl != null ? (
                <span className={cx(styles.dayPnl, pnl >= 0 ? styles.profit : styles.loss)}>
                  {yenSigned(pnl)}
                </span>
              ) : null}
              {day.tradeCount > 0 ? (
                <span className={styles.dayCount}>
                  {day.tradeCount} trade{day.tradeCount === 1 ? '' : 's'}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <p className={styles.legend}>
        Tint shows realized P&L for the day — green for gains, red for losses, stronger for larger.
        Click any day to journal how it felt.
      </p>

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
