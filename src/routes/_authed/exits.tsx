/**
 * Exit Rules — every open position read against the swing framework.
 *
 * Ordered by urgency rather than by symbol or size. The screen exists to answer
 * one question in the morning ("is there anything I have to do?"), and sorting
 * alphabetically buries a stopped-out position under six that need nothing.
 *
 * All arithmetic happens server-side in `lib/exit/rules.ts`; this route renders
 * decisions that have already been made.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import styles from './exits.module.scss'
import { ExitCard } from '~/components/exits/ExitCard'
import { ExitRuleDialog } from '~/components/exits/ExitRuleDialog'
import { ExitSettingsForm } from '~/components/exits/ExitSettingsForm'
import { Empty, PageHeader, Section } from '~/components/screen'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
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

function Exits() {
  const initial = Route.useLoaderData()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  /** Non-null while correcting an existing plan rather than opening one. */
  const [editing, setEditing] = useState<ExitRuleRow | null>(null)

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

  const ordered = useMemo(
    () =>
      [...data.rules].sort((left, right) => {
        const bySeverity =
          SEVERITY_RANK[left.actionSeverity] - SEVERITY_RANK[right.actionSeverity]
        return bySeverity !== 0 ? bySeverity : right.tradingDaysHeld - left.tradingDaysHeld
      }),
    [data.rules],
  )

  const needingAction = ordered.filter((row) => row.actionSeverity !== 'neutral').length

  return (
    <>
      <PageHeader
        title="Exit Rules"
        meta={
          data.rules.length === 0
            ? 'Stops, targets and trails for open swing positions.'
            : `${String(data.rules.length)} open plan${data.rules.length === 1 ? '' : 's'} · ${String(needingAction)} needing attention`
        }
      >
        <button
          type="button"
          className={styles.newButton}
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          disabled={data.eligible.length === 0}
          title={
            data.eligible.length === 0
              ? 'Every open equity position already has a plan'
              : undefined
          }
        >
          New plan
        </button>
      </PageHeader>

      {/*
        The single most likely failure of this whole feature is a lapsed alert,
        so the two ways the feed can be silent get said plainly and up front
        rather than being inferred from cards that all read "stale".
      */}
      {data.webhookConfigured ? null : (
        <p className={styles.warning}>
          <strong>Webhook not configured.</strong> Set <code>TRADINGVIEW_WEBHOOK_SECRET</code> in the
          environment, then point each TradingView alert at{' '}
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
      ) : (
        <div className={styles.grid}>
          {ordered.map((row) => (
            <ExitCard
              key={row.id}
              row={row}
              onArchive={(id) => { archive.mutate(id) }}
              onEdit={(target) => {
                setEditing(target)
                setDialogOpen(true)
              }}
            />
          ))}
        </div>
      )}

      {data.closed.length === 0 ? null : (
        <Section
          title="Closed positions"
          description="The holding is gone but the plan is still live. Archiving keeps the record without cluttering the list above."
        >
          <ul className={styles.closedList}>
            {data.closed.map((row) => (
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
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Framework settings"
        description="The stop and Target 1 multiples are frozen into each plan when it is created, so changing them affects new plans only. Trail width, time stop and staleness are path-dependent and apply everywhere on the next read."
      >
        <ExitSettingsForm settings={data.settings} onSaved={refresh} />
      </Section>

      <ExitRuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eligible={data.eligible}
        editing={editing}
        defaultMethod={data.settings.trailingMethod}
        onSaved={refresh}
      />
    </>
  )
}
