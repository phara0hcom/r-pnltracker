import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import styles from './calendar.module.scss'
import { NoteDialog } from '~/components/calendar/NoteDialog'
import { tone, yenSigned } from '~/components/format'
import { PageHeader } from '~/components/Screen'
import { AccountSwitch, useAccountFilter } from '~/components/ui/AccountSwitch'
import { accountScopeSchema } from '~/lib/accountScope'
import { cx } from '~/lib/cx'
import { thisMonthLocal } from '~/lib/localDate'
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

  const { data: dayList = [] } = useQuery({
    queryKey: ['calendar', month, account],
    queryFn: () => getCalendar({ data: { month, account } }),
  })

  const save = useMutation({
    mutationFn: saveNote,
    onSuccess: () => {
      setOpenDay(null)
      void queryClient.invalidateQueries()
    },
  })

  const del = useMutation({
    mutationFn: (date: string) => removeNote({ data: { date } }),
    onSuccess: () => {
      setOpenDay(null)
      void queryClient.invalidateQueries()
    },
  })

  const shift = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 + delta, 1))
    void navigate({ search: { month: d.toISOString().slice(0, 7) } })
  }

  // Monday-first grid: JS getUTCDay() is Sunday-based, so Sunday maps to 6.
  const first = dayList[0]
  const leadingBlanks = first ? (new Date(`${first.date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0

  const traded = dayList.filter((day) => day.tradeCount > 0)
  const monthPnl = dayList.reduce((a, d) => a + (d.realizedJpy ? Number(d.realizedJpy) : 0), 0)
  const journalled = dayList.filter((day) => day.note != null).length

  // Scale tint by the largest absolute day so a quiet month still shows contrast.
  const peak = Math.max(1, ...dayList.map((day) => Math.abs(Number(day.realizedJpy ?? 0))))

  return (
    <>
      <PageHeader
        title="Calendar"
        meta={
          <>
            {traded.length} trading day{traded.length === 1 ? '' : 's'} ·{' '}
            <span className={tone(monthPnl) === 'profit' ? styles.profit : tone(monthPnl) === 'loss' ? styles.loss : ''}>
              {yenSigned(monthPnl)}
            </span>{' '}
            · {journalled} journalled
          </>
        }
      >
        <div className={styles.nav}>
          <AccountSwitch value={account} onChange={setAccount} />
          <button type="button" className={styles.navButton} onClick={() => { shift(-1) }} aria-label="Previous month">
            ←
          </button>
          <span className={styles.monthLabel}>{month}</span>
          <button type="button" className={styles.navButton} onClick={() => { shift(1) }} aria-label="Next month">
            →
          </button>
          <button
            type="button"
            className={styles.navButton}
            onClick={() => { void navigate({ search: { month: thisMonthLocal() } }) }}
          >
            Today
          </button>
        </div>
      </PageHeader>

      <div className={styles.grid} role="grid" aria-label={`Trading calendar for ${month}`}>
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} className={styles.weekday} role="columnheader">
            {weekday}
          </div>
        ))}

        {Array.from({ length: leadingBlanks }, (_, i) => (
          <div key={`blank-${String(i)}`} className={styles.blank} aria-hidden="true" />
        ))}

        {dayList.map((day) => {
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
              <span className={styles.dayNum}>{Number(day.date.slice(-2))}</span>
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
          saving={save.isPending || del.isPending}
          onClose={() => { setOpenDay(null) }}
          onSave={(note) => { save.mutate({ data: note }) }}
          onDelete={(date) => { del.mutate(date) }}
        />
      ) : null}
    </>
  )
}
