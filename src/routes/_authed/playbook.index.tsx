/**
 * Playbook — trades grouped by the play they were taken on, and how each play
 * actually performs.
 *
 * A playbook earns its keep in the statistics row: win rate and mean R over
 * closed trades, and the mean overall score. Paper trades are summarised
 * beside real ones rather than mixed in, so a setup that only works on paper
 * says so instead of hiding in an average.
 *
 * Everything is computed server-side (`lib/playbook/score.ts`); this renders.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import styles from './playbook.module.scss'
import { ACCOUNT_LABEL, moneySigned, pct, tone } from '~/components/format'
import { NewReviewDialog } from '~/components/playbook/NewReviewDialog'
import { PlaybookDialog } from '~/components/playbook/PlaybookDialog'
import { Empty, PageHeader, Section, StatStrip, StripCell, Table } from '~/components/screen'
import { cx } from '~/lib/cx'
import {
  archivePlaybookFn,
  getPlaybookScreen,
  type PlaybookStatsView,
  type PlaybookView,
  type ReviewRow,
} from '~/server/playbook'

export const Route = createFileRoute('/_authed/playbook/')({
  component: Playbook,
  loader: () => getPlaybookScreen(),
})

const score = (value: number | null) => (value === null ? '—' : value.toFixed(1))

function Stats({ stats, label }: { stats: PlaybookStatsView; label: string }) {
  return (
    <StatStrip>
      <StripCell
        label={`${label} reviews`}
        value={stats.reviews}
        hint={`${String(stats.closed)} closed`}
      />
      <StripCell label="Win rate" value={stats.winRate === null ? '—' : pct(stats.winRate, 0)} />
      <StripCell
        label="Avg R"
        value={stats.avgR === null ? '—' : `${stats.avgR}R`}
        tone={stats.avgR === null ? undefined : tone(stats.avgR)}
        hint="Expectancy per trade"
      />
      <StripCell label="Avg score" value={score(stats.avgScore)} hint="of 10" />
    </StatStrip>
  )
}

function ReviewTable({ rows }: { rows: ReviewRow[] }) {
  if (rows.length === 0) return <Empty>No reviews filed under this play yet.</Empty>
  return (
    <Table caption="Reviews">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Dates</th>
          <th data-numeric>Result</th>
          <th data-numeric>R</th>
          <th data-numeric>Entry</th>
          <th data-numeric>Exit</th>
          <th data-numeric>Risk</th>
          <th data-numeric>Overall</th>
          <th>Mistakes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <Link
                to="/playbook/$reviewId"
                params={{ reviewId: row.id }}
                className={styles.symbol}
              >
                {row.symbol} <span className={styles.name}>{row.name}</span>
              </Link>
              <span className={styles.badge}>
                {row.kind === 'PAPER'
                  ? 'Paper'
                  : (ACCOUNT_LABEL[row.accountType ?? ''] ?? row.accountType)}
              </span>
              {row.open ? <span className={styles.badge}>Open</span> : null}
            </td>
            <td>
              {row.firstDate ?? '—'}
              {row.lastDate && row.lastDate !== row.firstDate ? ` → ${row.lastDate}` : ''}
            </td>
            <td data-numeric className={styles[tone(row.pnl)]}>
              {row.pnl === null ? '—' : moneySigned(row.pnl, row.currency)}
            </td>
            <td data-numeric className={styles[tone(row.rMultiple)]}>
              {row.rMultiple === null ? '—' : `${row.rMultiple}R`}
            </td>
            <td data-numeric>{score(row.entryRating)}</td>
            <td data-numeric>{score(row.exitRating)}</td>
            <td data-numeric>{score(row.riskRating)}</td>
            <td data-numeric className={styles.overall}>
              {score(row.overall)}
              {row.provisional && row.overall !== null ? (
                <span className={styles.provisional}>*</span>
              ) : null}
            </td>
            <td className={styles.mistakes}>{row.mistakes.join(', ')}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

function Playbook() {
  const initial = Route.useLoaderData()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['playbook-screen'],
    queryFn: () => getPlaybookScreen(),
    initialData: initial,
  })
  const [editing, setEditing] = useState<PlaybookView | null>(null)
  const [playbookOpen, setPlaybookOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewFor, setReviewFor] = useState<string | null>(null)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['playbook-screen'] })
  }

  const archive = async (playbook: PlaybookView) => {
    await archivePlaybookFn({ data: { id: playbook.id, archived: !playbook.archived } })
    refresh()
  }

  const live = data.playbooks.filter((playbook) => !playbook.archived)
  const archived = data.playbooks.filter((playbook) => playbook.archived)
  const unfiled = data.reviews.filter((review) => review.playbookId === null)
  const rowsFor = (id: string) => data.reviews.filter((review) => review.playbookId === id)

  const section = (playbook: PlaybookView) => (
    <Section
      key={playbook.id}
      title={playbook.name}
      description={playbook.description || undefined}
      actions={
        <>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              setReviewFor(playbook.id)
              setReviewOpen(true)
            }}
          >
            Add review
          </button>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              setEditing(playbook)
              setPlaybookOpen(true)
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              void archive(playbook)
            }}
          >
            {playbook.archived ? 'Restore' : 'Archive'}
          </button>
        </>
      }
    >
      {playbook.criteria.length > 0 ? (
        <ul className={styles.criteria}>
          {playbook.criteria.map((criterion) => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      ) : null}
      <div className={styles.stack}>
        <Stats stats={playbook.real} label="Real" />
        {playbook.paper.reviews > 0 ? <Stats stats={playbook.paper} label="Paper" /> : null}
        <ReviewTable rows={rowsFor(playbook.id)} />
      </div>
    </Section>
  )

  return (
    <>
      <PageHeader
        title="Playbook"
        meta={`${String(live.length)} play${live.length === 1 ? '' : 's'} · ${String(data.reviews.length)} review${data.reviews.length === 1 ? '' : 's'}`}
      >
        <button
          type="button"
          className={styles.newButton}
          onClick={() => {
            setEditing(null)
            setPlaybookOpen(true)
          }}
        >
          New playbook
        </button>
        <button
          type="button"
          className={cx(styles.newButton, styles.primaryButton)}
          onClick={() => {
            setReviewFor(null)
            setReviewOpen(true)
          }}
        >
          New review
        </button>
      </PageHeader>

      <p className={styles.note}>
        Overall is out of 10: entry, exit and risk a quarter each, the result the last quarter — so
        a well-run loss outscores a lucky gamble. <span className={styles.provisional}>*</span>{' '}
        marks a score still missing a part: an open trade, an unrated leg, or no stop to measure
        risk from.
      </p>

      {data.playbooks.length === 0 && data.reviews.length === 0 ? (
        <Empty>
          Start with a playbook — a type of play and the conditions that make a trade one — then
          review trades against it.
        </Empty>
      ) : null}

      {live.map(section)}

      {unfiled.length > 0 ? (
        <Section title="Not in a playbook" description="Reviews with no play assigned yet.">
          <ReviewTable rows={unfiled} />
        </Section>
      ) : null}

      {archived.map(section)}

      <PlaybookDialog
        open={playbookOpen}
        onOpenChange={setPlaybookOpen}
        editing={editing}
        onSaved={refresh}
      />
      <NewReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        playbooks={data.playbooks}
        pools={data.pools}
        defaultPlaybookId={reviewFor}
        onCreated={(id) => {
          refresh()
          void navigate({ to: '/playbook/$reviewId', params: { reviewId: id } })
        }}
      />
    </>
  )
}
