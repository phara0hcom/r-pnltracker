/**
 * One setup: its figures and criteria, its best and worst trades side by side, and
 * then all its positions.
 *
 * Which ranking shows is in the URL, like every filter. Every ranking arrives with
 * the page, so switching needs no request. The positions below are everything filed
 * under the setup, whichever ranking is showing; a paper one says so on its row.
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { LinkLoader } from '~/components/playbook/PositionDialogs'
import { PositionTable } from '~/components/playbook/PositionTable'
import { RankedTrades } from '~/components/playbook/RankedTrades'
import { SetupDialog } from '~/components/playbook/SetupDialog'
import { KIND_LABEL, KindTag, SetupFigures } from '~/components/playbook/SetupFigures'
import styles from '~/components/playbook/Setups.module.scss'
import { Empty, PageHeader, Section, SegmentedTabs } from '~/components/screen'
import type { RankBy } from '~/lib/playbook/stats'
import type { JournalKind } from '~/lib/playbook/types'
import { setupPageSearchSchema, type PlaybookSortKey } from '~/lib/playbookSearch'
import { nextSort } from '~/lib/sortRows'
import { getSetupPage } from '~/server/playbook'

export const Route = createFileRoute('/_authed/playbook/setups/$setupId')({
  validateSearch: setupPageSearchSchema,
  component: Setup,
  loader: ({ params }) => getSetupPage({ data: { id: params.setupId } }),
})

const RANK_TABS: { id: RankBy; label: string }[] = [
  { id: 'SCORE', label: 'Overall score' },
  { id: 'R', label: 'R result' },
]

function Setup() {
  const initial = Route.useLoaderData()
  const { setupId } = Route.useParams()
  const { kind: wantedKind, rank = 'SCORE', sortBy, sortDir = 'desc' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const leave = useNavigate()
  const [editing, setEditing] = useState(false)
  const [linking, setLinking] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['playbook', 'setup', setupId],
    queryFn: () => getSetupPage({ data: { id: setupId } }),
    initialData: initial,
  })

  const onSort = useCallback(
    (col: PlaybookSortKey) => {
      void navigate({
        search: (prev) => ({ ...prev, ...nextSort(col, sortBy ?? ('' as PlaybookSortKey), sortDir) }),
        replace: true,
        resetScroll: false,
      })
    },
    [navigate, sortBy, sortDir],
  )

  if (!data) {
    return (
      <>
        <Link to="/playbook/setups" className={styles.back}>
          ← Setups
        </Link>
        <Empty>That setup no longer exists.</Empty>
      </>
    )
  }

  const { setup, kinds, figures, rankings, trades, rows } = data
  const kind: JournalKind = wantedKind && kinds.includes(wantedKind) ? wantedKind : (kinds[0] ?? 'REAL')

  return (
    <>
      <Link to="/playbook/setups" className={styles.back}>
        ← Setups
      </Link>
      <PageHeader title={setup.name} actionsBeside>
        {setup.archived ? null : (
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              setEditing(true)
            }}
          >
            Edit
          </button>
        )}
      </PageHeader>

      <div className={styles.header}>
        {setup.archived ? (
          <p className={styles.warning}>
            Archived. Its positions stay on the Playbook, but it takes no new ones and cannot be edited.
          </p>
        ) : null}
        {setup.description ? <p className={styles.description}>{setup.description}</p> : null}
        {kinds.map((used) => (
          <div key={used} className={styles.kindFigures}>
            <KindTag kind={used} />
            <SetupFigures figures={figures[used]} />
          </div>
        ))}
        {setup.criteria.length > 0 ? (
          <ul className={styles.criteria} aria-label="Criteria">
            <li className={styles.criteriaLabel} aria-hidden="true">
              Criteria
            </li>
            {setup.criteria.map((criterion) => (
              <li key={criterion.id} className={styles.criterion}>
                {criterion.text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {kinds.length === 0 ? (
        <Empty>No positions under this setup yet. File one from Open position on the Playbook.</Empty>
      ) : (
        <>
          <Section title="Best and worst" description="Closed positions only.">
            <div className={styles.controls}>
              {kinds.length > 1 ? (
                <div className={styles.control}>
                  <SegmentedTabs
                    label="Show trades that were"
                    tabs={kinds.map((id) => ({ id, label: KIND_LABEL[id] }))}
                    active={kind}
                    onChange={(next) => {
                      void navigate({ search: (prev) => ({ ...prev, kind: next }), replace: true, resetScroll: false })
                    }}
                  />
                </div>
              ) : null}
              <div className={styles.control}>
                <SegmentedTabs
                  label="Rank by"
                  tabs={RANK_TABS}
                  active={rank}
                  onChange={(next) => {
                    void navigate({
                      search: (prev) => ({ ...prev, rank: next === 'SCORE' ? undefined : next }),
                      replace: true,
                      resetScroll: false,
                    })
                  }}
                />
              </div>
            </div>
            <RankedTrades ranking={rankings[kind][rank]} byR={rank === 'R'} trades={trades} />
          </Section>

          <Section title="All positions">
            <PositionTable
              rows={rows}
              kind={kinds.length > 1 ? 'ALL' : kind}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={onSort}
              onLink={(row) => {
                setLinking(row.id)
              }}
            />
          </Section>
        </>
      )}

      {editing ? (
        <SetupDialog
          setup={setup}
          onClose={() => {
            setEditing(false)
          }}
          onArchived={() => {
            void leave({ to: '/playbook/setups' })
          }}
        />
      ) : null}
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
