/**
 * The Playbook: every position, open or closed, one holding streak to a row.
 *
 * Filters and sort live in the URL, like every other screen. Sorting and filtering
 * are client-side over rows already loaded: nothing about a filter changes what
 * the server has to work out, since a position's figures never depend on another's.
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import styles from './playbook.module.scss'
import { ExitLadder } from '~/components/exits/ExitLadder'
import { ACCOUNT_LABEL, priceText } from '~/components/format'
import { OpenPositionDialog } from '~/components/playbook/OpenPositionDialog'
import { LinkDialog } from '~/components/playbook/PositionDialogs'
import { PositionTable, STATUS_LABEL } from '~/components/playbook/PositionTable'
import { usePlaybookAction } from '~/components/playbook/usePlaybookAction'
import { Empty, PageHeader, Section } from '~/components/screen'
import { AccountFilterControl } from '~/components/ui/AccountFilterControl'
import { useAccountFilter } from '~/components/ui/AccountSwitch'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { MarketFilterControl } from '~/components/ui/MarketFilterControl'
import { marketParam } from '~/lib/marketScope'
import {
  KIND_FILTERS,
  matchesPlaybookFilters,
  playbookSearchSchema,
  STATUS_FILTERS,
  type KindFilter,
  type PlaybookSortKey,
} from '~/lib/playbookSearch'
import { nextSort } from '~/lib/sortRows'
import {
  archivePlan,
  fileExitPlans,
  getPlaybook,
  getPosition,
  type ActionResult,
  type PositionRow,
} from '~/server/playbook'

export const Route = createFileRoute('/_authed/playbook/')({
  validateSearch: playbookSearchSchema,
  component: Playbook,
  loader: () => getPlaybook(),
})

const KIND_LABEL: Record<KindFilter, string> = { REAL: 'Real', PAPER: 'Paper', ALL: 'Real and paper' }

/** Loads the full position only when its dialog opens. */
function LinkLoader({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['playbook', 'position', id],
    queryFn: () => getPosition({ data: { id } }),
  })
  return data ? <LinkDialog position={data} onClose={onClose} /> : null
}

function NeedsAction({ rows, onArchive }: { rows: PositionRow[]; onArchive: (planId: string) => void }) {
  return (
    <Section
      title="Needs action"
      description="Plans the framework rates urgent or attention, and live plans whose position is over."
    >
      <ul className={styles.actions}>
        {rows.map((row) => {
          const plan = row.plan!
          const finished = plan.actionKind === 'POSITION_CLOSED' || plan.actionKind === 'PLAN_SUPERSEDED'
          return (
            <li key={row.id} className={styles.action} data-severity={plan.actionSeverity}>
              <div className={styles.actionHead}>
                <span>
                  {row.symbol} {row.name} · {ACCOUNT_LABEL[plan.accountType] ?? plan.accountType}
                </span>
                <span className={styles.actionLevels}>
                  stop {priceText(plan.currentStop, plan.currency)} · last {priceText(plan.currentPrice, plan.currency)}
                </span>
              </div>
              <p className={styles.actionMessage}>{plan.actionMessage}</p>
              <ExitLadder row={plan} />
              <div className={styles.actionButtons}>
                {finished ? (
                  <ConfirmButton
                    size="small"
                    title="Retire this exit plan"
                    onConfirm={() => {
                      onArchive(plan.id)
                    }}
                  >
                    Archive exit plan
                  </ConfirmButton>
                ) : null}
                <Link to="/playbook/$journalId" params={{ journalId: row.id }} className={styles.openLink}>
                  Open<span className="visually-hidden"> {row.symbol}</span>
                </Link>
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function Playbook() {
  const initial = Route.useLoaderData()
  const { market = 'ALL', setup, status, kind = 'REAL', sortBy, sortDir = 'desc' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [account, setAccount] = useAccountFilter()
  const [opening, setOpening] = useState(false)
  const [linking, setLinking] = useState<string | null>(null)

  const { data } = useQuery({ queryKey: ['playbook', 'list'], queryFn: () => getPlaybook(), initialData: initial })

  const onSort = useCallback(
    (col: PlaybookSortKey) => {
      void navigate({
        search: (prev) => ({ ...prev, ...nextSort(col, sortBy ?? ('' as PlaybookSortKey), sortDir) }),
        replace: true,
      })
    },
    [navigate, sortBy, sortDir],
  )

  const rows = useMemo(
    () => data.rows.filter((row) => matchesPlaybookFilters(row, { account, market, setup, status, kind })),
    [data.rows, account, market, setup, status, kind],
  )

  const archive = usePlaybookAction((id: string): Promise<ActionResult> => archivePlan({ data: { id } }))
  const file = usePlaybookAction(async (): Promise<ActionResult> => {
    await fileExitPlans()
    return { ok: true }
  })

  const needing = data.needsAction.length

  return (
    <>
      <PageHeader
        title="Playbook"
        meta={`${String(data.rows.length)} position${data.rows.length === 1 ? '' : 's'}${needing ? ` · ${String(needing)} needing action` : ''}`}
        filter={
          <div className={styles.filters}>
            <AccountFilterControl value={account} onChange={setAccount} />
            <MarketFilterControl
              value={market}
              onChange={(next) => {
                void navigate({
                  search: (prev) => ({ ...prev, market: marketParam(next) }),
                  replace: true,
                  resetScroll: false,
                })
              }}
            />
          </div>
        }
        actionsBeside
      >
        <button
          type="button"
          className={styles.openButton}
          onClick={() => {
            setOpening(true)
          }}
        >
          Open position
        </button>
      </PageHeader>

      {data.webhookConfigured ? null : (
        <p className={styles.warning}>
          <strong>Webhook not configured.</strong> Set <code>TRADINGVIEW_WEBHOOK_SECRET</code> to at least 24 characters
          and point each TradingView alert at <code>/api/tv/&lt;secret&gt;</code>. Until then every live plan reads as
          stale. See <code>docs/exit-rules.md</code>.
        </p>
      )}

      {data.plansToFile > 0 ? (
        <div className={styles.banner}>
          <span>
            {data.plansToFile} exit plan{data.plansToFile === 1 ? '' : 's'} from before the Playbook.
          </span>
          <button
            type="button"
            className={styles.openButton}
            disabled={file.pending}
            onClick={() => {
              file.run(undefined)
            }}
          >
            {file.pending ? 'Filing…' : `File ${String(data.plansToFile)} existing exit plan${data.plansToFile === 1 ? '' : 's'} in the Playbook`}
          </button>
        </div>
      ) : null}

      {data.orphanPlans.length > 0 ? (
        <Section
          title="Plans with no trades to file under"
          description="No holding streak matches these plans, so they can only be archived."
        >
          <ul className={styles.orphans}>
            {data.orphanPlans.map((plan) => (
              <li key={plan.planId} className={styles.orphan}>
                <span>
                  {plan.symbol} {plan.name} · {ACCOUNT_LABEL[plan.accountType] ?? plan.accountType} · entered{' '}
                  {plan.entryDate}
                </span>
                <ConfirmButton
                  size="small"
                  onConfirm={() => {
                    archive.run(plan.planId)
                  }}
                >
                  Archive
                </ConfirmButton>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {archive.problem ?? file.problem ? (
        <p className={styles.warning} role="alert">
          {archive.problem ?? file.problem}
        </p>
      ) : null}

      {needing > 0 ? (
        <NeedsAction
          rows={data.needsAction}
          onArchive={(id) => {
            archive.run(id)
          }}
        />
      ) : null}

      <div className={styles.toolbar}>
        <label className={styles.filter}>
          Setup
          <select
            value={setup ?? ''}
            onChange={(event) => {
              const next = event.target.value || undefined
              void navigate({ search: (prev) => ({ ...prev, setup: next }), replace: true, resetScroll: false })
            }}
          >
            <option value="">All</option>
            {data.setups.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filter}>
          Status
          <select
            value={status ?? ''}
            onChange={(event) => {
              const next = (event.target.value || undefined) as typeof status
              void navigate({ search: (prev) => ({ ...prev, status: next }), replace: true, resetScroll: false })
            }}
          >
            <option value="">All</option>
            {STATUS_FILTERS.map((option) => (
              <option key={option} value={option}>
                {STATUS_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filter}>
          Kind
          <select
            value={kind}
            onChange={(event) => {
              const next = event.target.value as KindFilter
              void navigate({
                search: (prev) => ({ ...prev, kind: next === 'REAL' ? undefined : next }),
                replace: true,
                resetScroll: false,
              })
            }}
          >
            {KIND_FILTERS.map((option) => (
              <option key={option} value={option}>
                {KIND_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data.rows.length === 0 ? (
        <Empty>No positions yet. Open one from a holding, from scratch, or from a past trade.</Empty>
      ) : (
        <PositionTable
          rows={rows}
          kind={kind}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
          onLink={(row) => {
            setLinking(row.id)
          }}
        />
      )}

      <OpenPositionDialog
        open={opening}
        onOpenChange={setOpening}
        onOpened={(id) => {
          void navigate({ to: '/playbook/$journalId', params: { journalId: id } })
        }}
      />
      {linking ? (
        <LinkLoader
          id={linking}
          onClose={() => {
            setLinking(null)
          }}
        />
      ) : null}
    </>
  )
}
