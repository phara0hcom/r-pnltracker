/**
 * Exit Rules — every open position read against the swing framework.
 *
 * The screen exists to answer one question in the morning ("is there anything I
 * have to do?"), so it is split by that answer rather than laid out uniformly.
 * Plans the framework rates `urgent` or `attention` keep a card; the rest
 * collapse into a table, where the figures compare down a column and nothing
 * competes with the position that is actually stopped out. Either one opens the
 * full plan in `ExitPlanDialog` — which is where Edit and Archive now live too,
 * since a button inside a click target is a button you cannot reach cleanly.
 *
 * The urgency sort is unchanged; it now partitions before it renders.
 *
 * All arithmetic happens server-side in `lib/exit/rules.ts`; this route renders
 * decisions that have already been made.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import styles from './exits.module.scss'
import { AccountDot } from '~/components/AccountDot'
import { ExitCard } from '~/components/exits/ExitCard'
import { ExitFlags } from '~/components/exits/ExitFlags'
import { ExitLadder } from '~/components/exits/ExitLadder'
import { ExitPlanDialog } from '~/components/exits/ExitPlanDialog'
import { ExitPlanRow } from '~/components/exits/ExitPlanRow'
import { ExitRuleDialog } from '~/components/exits/ExitRuleDialog'
import { ExitSettingsForm } from '~/components/exits/ExitSettingsForm'
import { FeedDeliveryLog } from '~/components/exits/FeedDeliveryLog'
import { OpenPlanButton } from '~/components/exits/OpenPlanButton'
import { money, moneySigned, tone } from '~/components/format'
import { Empty, PageHeader, Section, Table } from '~/components/screen'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { useIsMobile } from '~/components/ui/useIsMobile'
import { cx } from '~/lib/cx'
import { archiveExitRule, getExitScreen, type ExitRuleRow } from '~/server/exit'

export const Route = createFileRoute('/_authed/exits')({
  component: Exits,
  loader: () => getExitScreen(),
})

/** Most urgent first; within a band, the longest-held position leads. */
const SEVERITY_RANK: Record<ExitRuleRow['actionSeverity'], number> = {
  urgent: 0,
  attention: 1,
  neutral: 2,
}

const ON_TRACK_NOTE =
  'The bar marks the effective stop and the last close between the initial stop and Target 1. A stale feed keeps its flag here, since the framework still rates the plan neutral.'

const ALL_CLEAR =
  'Nothing needs a decision today — every open plan is holding between its stop and Target 1.'

/** The on-track table, re-expressed for a phone, where eight columns cannot go. */
function TrackRowSp({
  row,
  onOpen,
}: {
  row: ExitRuleRow
  onOpen: (row: ExitRuleRow) => void
}) {
  return (
    <div className={styles.spRow}>
      <OpenPlanButton row={row} onOpen={onOpen} />

      <div className={styles.spRowHead}>
        <span className={styles.spIdentity}>
          <AccountDot accountType={row.accountType} />
          <span className={styles.spName}>
            {row.symbol} {row.name}
          </span>
        </span>
        <span className={cx(styles.spPnl, styles[tone(row.unrealizedTotal)])}>
          {moneySigned(row.unrealizedTotal, row.currency)}
        </span>
      </div>

      <ExitLadder row={row} className={styles.spLadder} />

      <span className={styles.spEnds}>
        <span>{money(row.currentStop, row.currency)}</span>
        <span>·</span>
        <span>{money(row.currentPrice, row.currency)}</span>
        <span>·</span>
        <span>{money(row.target1, row.currency)}</span>
        {/*
          The flags are drawn here and nowhere else on a phone. An on-track row
          carries no recommendation sentence, so for a plan whose feed has gone
          quiet this badge is the only thing that says so — and a lapsed alert
          is the failure this whole feature is most likely to suffer.
        */}
        <ExitFlags row={row} compact />
        <span className={styles.spSessions}>{row.tradingDaysHeld} sessions</span>
      </span>
    </div>
  )
}

function Exits() {
  const initial = Route.useLoaderData()
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  /** Non-null while correcting an existing plan rather than opening one. */
  const [editing, setEditing] = useState<ExitRuleRow | null>(null)
  /**
   * The plan whose detail dialog is open, held by id rather than by row.
   *
   * `data` is refetched while the dialog sits open — a window-focus refetch, a
   * bar arriving from the webhook — and a captured row would go on showing the
   * levels as they stood when it was clicked, which is precisely the stale
   * reading this screen exists to prevent.
   */
  const [viewingId, setViewingId] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['exit-screen'],
    queryFn: () => getExitScreen(),
    initialData: initial,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['exit-screen'] })
  }

  const archive = useMutation({
    mutationFn: (id: string) => archiveExitRule({ data: { id } }),
    onSuccess: refresh,
  })

  const { action, onTrack } = useMemo(() => {
    const ordered = [...data.rules].sort((left, right) => {
      const bySeverity =
        SEVERITY_RANK[left.actionSeverity] - SEVERITY_RANK[right.actionSeverity]
      return bySeverity !== 0 ? bySeverity : right.tradingDaysHeld - left.tradingDaysHeld
    })
    return {
      action: ordered.filter((row) => row.actionSeverity !== 'neutral'),
      onTrack: ordered.filter((row) => row.actionSeverity === 'neutral'),
    }
  }, [data.rules])

  /* Resolved from the live list, so an archived plan closes its own dialog. */
  const viewing = data.rules.find((row) => row.id === viewingId) ?? null

  const openPlan = (row: ExitRuleRow) => {
    setViewingId(row.id)
  }

  const onTrackCount = onTrack.length

  return (
    <>
      <PageHeader
        title="Exit Rules"
        meta={
          data.rules.length === 0
            ? 'Stops, targets and trails for open swing positions.'
            : isMobile
              ? `${String(data.rules.length)} plan${data.rules.length === 1 ? '' : 's'} · ${String(action.length)} need${action.length === 1 ? 's' : ''} attention`
              : `${String(data.rules.length)} open plan${data.rules.length === 1 ? '' : 's'} · ${String(action.length)} needing attention`
        }
      >
        <button
          type="button"
          className={styles.newButton}
          onClick={() => {
            setEditing(null)
            setRuleDialogOpen(true)
          }}
          disabled={data.eligible.length === 0}
          title={
            data.eligible.length === 0
              ? 'Every open equity position already has a plan'
              : undefined
          }
        >
          {isMobile ? 'New' : 'New plan'}
        </button>
      </PageHeader>

      {/*
        The single most likely failure of this whole feature is a lapsed alert,
        so the two ways the feed can be silent get said plainly and up front
        rather than being inferred from cards that all read "stale".
      */}
      {data.webhookConfigured ? null : (
        <p className={styles.warning}>
          <strong>Webhook not configured.</strong> Set <code>TRADINGVIEW_WEBHOOK_SECRET</code> to a
          value of at least 24 characters — the endpoint refuses a shorter one — then point each
          TradingView alert at{' '}
          <code>/api/tv/&lt;secret&gt;</code>. Until then no bars can arrive and every plan will read
          as stale. See <code>docs/exit-rules.md</code>.
        </p>
      )}

      {data.rules.length === 0 ? (
        <Empty>
          {data.eligible.length === 0
            ? 'No open equity positions to plan an exit for. Import some trades first.'
            : 'No exit plans yet. Open one over a holding to get stops, targets and a daily recommendation.'}
        </Empty>
      ) : isMobile ? (
        <>
          <h2 className={styles.spSectionTitle}>Needs a decision</h2>
          {action.length === 0 ? (
            <p className={styles.spNote}>{ALL_CLEAR}</p>
          ) : (
            <div className={styles.spCards}>
              {action.map((row) => (
                <ExitCard key={row.id} row={row} onOpen={openPlan} compact />
              ))}
            </div>
          )}

          {onTrackCount === 0 ? null : (
            <>
              <h2 className={styles.spSectionTitle}>On track · {onTrackCount}</h2>
              <div className={styles.spList}>
                {onTrack.map((row) => (
                  <TrackRowSp key={row.id} row={row} onOpen={openPlan} />
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <Section
            title="Needs a decision today"
            description={
              action.length === 0
                ? undefined
                : 'Anything the framework rates urgent or attention, most urgent first. Click for the full plan.'
            }
          >
            {action.length === 0 ? (
              <Empty>{ALL_CLEAR}</Empty>
            ) : (
              <div className={styles.cards}>
                {action.map((row) => (
                  <ExitCard key={row.id} row={row} onOpen={openPlan} />
                ))}
              </div>
            )}
          </Section>

          {onTrackCount === 0 ? null : (
            <Section
              title="On track"
              description={`${String(onTrackCount)} plan${onTrackCount === 1 ? '' : 's'} holding between ${onTrackCount === 1 ? 'its' : 'their'} stop and Target 1. Nothing to do.`}
            >
              <Table caption="Exit plans the framework rates neutral, one row per plan">
                <thead>
                  <tr>
                    <th scope="col">Instrument</th>
                    <th scope="col">Stop → Target 1</th>
                    <th scope="col" data-numeric>Current</th>
                    <th scope="col" data-numeric>Eff. stop</th>
                    <th scope="col" data-numeric>Target 1</th>
                    <th scope="col" data-numeric>Unrealized</th>
                    <th scope="col" data-numeric>Held</th>
                    <th scope="col">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {onTrack.map((row) => (
                    <ExitPlanRow key={row.id} row={row} onOpen={openPlan} />
                  ))}
                </tbody>
              </Table>
              <p className={styles.tableNote}>{ON_TRACK_NOTE}</p>
            </Section>
          )}
        </>
      )}

      {data.toArchive.length === 0 ? null : (
        <Section
          title="Plans to archive"
          description="The plan no longer describes a live swing — the holding is gone, or it was closed and re-entered after the plan was made. Archiving keeps the record, and frees the position to be planned again."
        >
          <ul className={styles.closedList}>
            {data.toArchive.map((row) => (
              <li key={row.id} className={styles.closedRow}>
                <span className={styles.closedName}>
                  {row.symbol} · {row.name}
                </span>
                <span className={styles.closedMeta}>
                  entered {row.entryDate} · {row.tradingDaysHeld} sessions
                </span>
                <ConfirmButton
                  size="small"
                  onConfirm={() => { archive.mutate(row.id) }}
                  title="Retire this exit plan"
                >
                  Archive
                </ConfirmButton>
                {/*
                  A superseded plan looks like an ordinary closed one in this
                  list, and the difference matters: the position is still open,
                  it just needs re-planning. The reason is spelled out rather
                  than left to be inferred from the entry date.
                */}
                {row.actionKind === 'PLAN_SUPERSEDED' ? (
                  <span className={styles.closedNote}>{row.actionMessage}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/*
        Below the plans, because it answers a question about the feed rather
        than about a position — but on this screen rather than in a log file,
        since "why does every plan read stale?" is asked here and nowhere else.
      */}
      <FeedDeliveryLog deliveries={data.deliveries} tally={data.deliveryTally} />

      <Section
        title="Framework settings"
        description="The stop and Target 1 multiples are frozen into each plan when it is created, so changing them affects new plans only. Trail width, time stop and staleness are path-dependent and apply everywhere on the next read."
      >
        <ExitSettingsForm settings={data.settings} onSaved={refresh} />
      </Section>

      <ExitPlanDialog
        row={viewing}
        onClose={() => { setViewingId(null) }}
        onArchive={(id) => {
          setViewingId(null)
          archive.mutate(id)
        }}
        onEdit={(target) => {
          // One dialog at a time: the read view steps aside for the form.
          setViewingId(null)
          setEditing(target)
          setRuleDialogOpen(true)
        }}
      />

      <ExitRuleDialog
        open={ruleDialogOpen}
        onOpenChange={setRuleDialogOpen}
        eligible={data.eligible}
        editing={editing}
        defaultMethod={data.settings.trailingMethod}
        onSaved={refresh}
      />
    </>
  )
}
