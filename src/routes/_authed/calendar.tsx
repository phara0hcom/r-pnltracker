/**
 * The trading calendar: a month of days, each tinted by what it realized, a
 * total per week, and the journal a day opens into.
 *
 * Every figure is worked out on the server — the days, the weeks and the
 * month's best, worst and average. The only arithmetic here is the tint's
 * scale, which is a matter of drawing rather than of money.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import styles from './calendar.module.scss'
import { CalendarGrid } from '~/components/calendar/CalendarGrid'
import { DayByDay } from '~/components/calendar/DayByDay'
import { monthLabel, weekdayDayMonth } from '~/components/calendar/dayText'
import { MoodFace } from '~/components/calendar/MoodFace'
import { NoteDialog, type NotePayload } from '~/components/calendar/NoteDialog'
import { tone, yenSigned } from '~/components/format'
import { MarketBreakdown } from '~/components/pnl/MarketSplit'
import { PageHeader } from '~/components/screen'
import { AccountFilterControl } from '~/components/ui/AccountFilterControl'
import { useAccountFilter } from '~/components/ui/AccountSwitch'
import { useIsMobile } from '~/components/ui/useIsMobile'
import { useToday } from '~/components/ui/useToday'
import { accountScopeSchema } from '~/lib/accountScope'
import { withNote } from '~/lib/calendarPatch'
import { cx } from '~/lib/cx'
import { thisMonthLocal } from '~/lib/localDate'
import { shiftMonth } from '~/lib/monthGrid'
import { reportError } from '~/lib/observability/report'
import { removeNote, saveNote } from '~/server/notes'
import { getCalendar, type CalendarDay, type CalendarMonth } from '~/server/screens'

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

const toneClass = (value: string | null | undefined) => {
  const name = tone(value)
  return name === 'flat' ? undefined : styles[name]
}

/** Previous, the month, next — one control — and Today beside it. */
function MonthNav({
  month,
  isCurrent,
  compact,
  onGo,
}: {
  month: string
  isCurrent: boolean
  compact: boolean
  onGo: (month: string) => void
}) {
  return (
    <nav className={cx(styles.monthNav, compact && styles.monthNavCompact)} aria-label="Month">
      <div className={styles.monthGroup}>
        <button
          type="button"
          className={styles.monthStep}
          onClick={() => {
            onGo(shiftMonth(month, -1))
          }}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className={styles.monthName} aria-live="polite">
          {monthLabel(month)}
        </span>
        <button
          type="button"
          className={styles.monthStep}
          onClick={() => {
            onGo(shiftMonth(month, 1))
          }}
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <button
        type="button"
        className={styles.todayButton}
        disabled={isCurrent}
        onClick={() => {
          onGo(thisMonthLocal())
        }}
      >
        Today
      </button>
    </nav>
  )
}

/** One figure in the month's summary: a label, the figure, and what it is of. */
function Fact({
  label,
  value,
  sub,
  tint,
}: {
  label: string
  value: string
  sub?: string
  tint?: string | undefined
}) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={cx(styles.factValue, tint)}>{value}</dd>
      {sub ? <dd className={styles.factSub}>{sub}</dd> : null}
    </div>
  )
}

function Calendar() {
  const { month } = Route.useSearch()
  const [account, setAccount] = useAccountFilter()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  // The date, not a copy of the day: the dialog must re-render from the query,
  // or saving a day's order leaves it showing the grouping and total from before.
  const [openDate, setOpenDate] = useState<string | null>(null)
  const isMobile = useIsMobile()

  const today = useToday()

  const calendarKey = ['calendar', month, account]

  const { data: calendar } = useQuery({
    queryKey: calendarKey,
    queryFn: () => getCalendar({ data: { month, account } }),
  })
  const dayList = calendar?.days
  const openDay = openDate == null ? null : (dayList?.find((day) => day.date === openDate) ?? null)

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
      queryClient.getQueryData<CalendarMonth>(calendarKey)?.days.find((day) => day.date === date)
        ?.note ?? null
    queryClient.setQueryData<CalendarMonth>(calendarKey, (cached) => withNote(cached, date, note))
    return previous
  }

  const save = useMutation({
    mutationFn: saveNote,
    onMutate: async ({ data }: { data: NotePayload }) => {
      // An in-flight refetch would otherwise land after this and overwrite it
      // with the pre-edit month.
      await queryClient.cancelQueries({ queryKey: calendarKey })
      setOpenDate(null)
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
    onError: (error, variables, context) => {
      reportError(error, { mutation: 'saveNote' })
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
      setOpenDate(null)
      return { previous: patchDay(date, null) }
    },
    onError: (error, date, context) => {
      reportError(error, { mutation: 'removeNote' })
      patchDay(date, context?.previous ?? null)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  })

  const goToMonth = (next: string) => {
    // Functional form: replacing the whole search object would drop `scope`, so
    // paging through months reset the account switch.
    void navigate({ search: (prev) => ({ ...prev, month: next }) })
  }

  const { byDate, peak, journalled } = useMemo(() => {
    if (!dayList) return { byDate: null, peak: 0, journalled: 0 }
    // The tint's scale: the month's largest day, so a quiet month still shows
    // contrast. A drawing scale, not a figure anyone reads.
    let largest = 0
    let noted = 0
    for (const day of dayList) {
      if (day.realizedJpy != null) largest = Math.max(largest, Math.abs(Number(day.realizedJpy)))
      if (day.note != null) noted += 1
    }
    return { byDate: new Map(dayList.map((day) => [day.date, day])), peak: largest, journalled: noted }
  }, [dayList])

  const summary = calendar?.summary
  const total = calendar?.markets?.totalJpy ?? null
  const failed = save.isError || del.isError

  const nav = (
    <MonthNav
      month={month}
      isCurrent={today?.startsWith(month) === true}
      compact={isMobile}
      onGo={goToMonth}
    />
  )

  const facts = summary ? (
    <>
      <Fact
        label="Best day"
        value={summary.best ? yenSigned(summary.best.realizedJpy) : '—'}
        sub={summary.best ? weekdayDayMonth(summary.best.date) : 'Nothing closed'}
        tint={toneClass(summary.best?.realizedJpy)}
      />
      <Fact
        label="Worst day"
        value={summary.worst ? yenSigned(summary.worst.realizedJpy) : '—'}
        sub={
          summary.worst
            ? weekdayDayMonth(summary.worst.date)
            : summary.closeDays === 1
              ? 'Only one day closed'
              : 'Nothing closed'
        }
        tint={toneClass(summary.worst?.realizedJpy)}
      />
      <Fact
        label="Green days"
        value={`${String(summary.greenDays)} green · ${String(summary.redDays)} red`}
        sub={`of ${String(summary.closeDays)} day${summary.closeDays === 1 ? '' : 's'} with a close`}
      />
      <Fact
        label="Avg per trading day"
        value={summary.avgPerTradingDayJpy == null ? '—' : yenSigned(summary.avgPerTradingDayJpy)}
        sub={`over ${String(summary.tradingDays)} trading day${summary.tradingDays === 1 ? '' : 's'}`}
        tint={toneClass(summary.avgPerTradingDayJpy)}
      />
      {isMobile ? null : (
        <Fact label="Journalled" value={String(journalled)} sub={`day${journalled === 1 ? '' : 's'} with an entry`} />
      )}
    </>
  ) : null

  const hero = (
    <>
      <span className={styles.heroLabel}>Realized this month</span>
      <span className={cx(styles.heroValue, toneClass(total))}>
        {calendar ? yenSigned(total ?? 0) : <span className={styles.pendingBar} aria-hidden="true" />}
      </span>
      <span className={styles.heroContext}>In yen, currency moves included</span>
      {calendar?.markets ? (
        <div className={styles.heroSplit}>
          <MarketBreakdown split={calendar.markets} />
        </div>
      ) : null}
    </>
  )

  return (
    <>
      <PageHeader
        title="Calendar"
        meta={
          summary
            ? `${monthLabel(month)} · ${String(summary.tradingDays)} trading day${
                summary.tradingDays === 1 ? '' : 's'
              } · ${String(journalled)} journalled`
            : 'Loading…'
        }
        filter={<AccountFilterControl value={account} onChange={setAccount} />}
      >
        {isMobile ? null : nav}
      </PageHeader>

      {isMobile ? nav : null}

      {failed ? (
        <p className={styles.error} role="alert">
          Could not save that journal entry — the day has been put back as it was. Please try again.
        </p>
      ) : null}

      {isMobile ? (
        <section className={cx(styles.card, styles.heroCard)} aria-label="This month">
          {hero}
          {facts ? <dl className={styles.factsCompact}>{facts}</dl> : null}
        </section>
      ) : (
        <div className={styles.summary}>
          <section className={cx(styles.card, styles.heroCard)} aria-label="Realized this month">
            {hero}
          </section>
          <dl className={cx(styles.card, styles.facts)} aria-busy={summary == null}>
            {facts}
          </dl>
        </div>
      )}

      <CalendarGrid
        month={month}
        label={`Trading calendar for ${monthLabel(month)}`}
        days={byDate}
        weeks={calendar?.weeks ?? null}
        peak={peak}
        today={today}
        compact={isMobile}
        onOpen={setOpenDate}
      />

      {isMobile ? (
        <p className={styles.legendText}>
          Tint and figure are the day&apos;s realized P&amp;L in yen, currency moves included. A blue dot
          marks a journal entry. Tap a day to open it.
        </p>
      ) : (
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.scale} aria-hidden="true">
              <span className={cx(styles.swatch, styles.lossStrong)} />
              <span className={cx(styles.swatch, styles.lossWeak)} />
              <span className={styles.swatch} />
              <span className={cx(styles.swatch, styles.profitWeak)} />
              <span className={cx(styles.swatch, styles.profitStrong)} />
            </span>
            Tint is the day in yen, currency moves included — stronger for larger
          </span>
          <span className={styles.legendItem}>
            <MoodFace mood={4} className={styles.legendFace} />
            Journal entry — the face shows the mood
          </span>
          <span className={styles.legendItem}>
            Each day shows the JPY account in yen and the USD account in dollars, as Rakuten does. Select a
            day for its trades and journal.
          </span>
        </div>
      )}

      {isMobile && byDate && calendar ? (
        <DayByDay weeks={calendar.weeks} days={byDate} today={today} onOpen={setOpenDate} />
      ) : null}

      {openDay ? (
        <NoteDialog
          day={openDay}
          scope={account}
          onClose={() => {
            setOpenDate(null)
          }}
          onSave={(note) => {
            save.mutate({ data: note })
          }}
          onDelete={(date) => {
            del.mutate(date)
          }}
        />
      ) : null}
    </>
  )
}
