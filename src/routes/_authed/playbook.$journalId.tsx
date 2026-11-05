/**
 * One position: its plan, score, legs and review.
 *
 * The back link is fixed. It always goes to `/playbook`, whichever page opened the
 * position, and the URL carries no `from`: the browser's Back is how to return to
 * wherever you were.
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import styles from './playbookPosition.module.scss'
import { ExitFlags } from '~/components/exits/ExitFlags'
import { ExitLadder } from '~/components/exits/ExitLadder'
import { ACCOUNT_LABEL, pct, priceText, qty, rSigned, tone } from '~/components/format'
import { ExternalIcon } from '~/components/icons/ExternalIcon'
import { Figure, figureStyles } from '~/components/playbook/Figure'
import { LivePlanFigures } from '~/components/playbook/LivePlanFigures'
import { FrameworkNote } from '~/components/playbook/PlanFields'
import { PositionCharts } from '~/components/playbook/PositionCharts'
import { EditPlanDialog, EditPositionDialog, LinkDialog } from '~/components/playbook/PositionDialogs'
import { ResultText, ScoreText, StatusBadge } from '~/components/playbook/PositionTable'
import { RatingInput } from '~/components/playbook/RatingInput'
import { usePlaybookAction } from '~/components/playbook/usePlaybookAction'
import { Empty, PageHeader, Section } from '~/components/screen'
import { ExecutionTimeInput } from '~/components/trades/ExecutionTimeInput'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { TagInput, withDraft } from '~/components/ui/TagInput'
import { cx } from '~/lib/cx'
import { formatJst, resolveExecutedAt, timedMarket, toTimeInput } from '~/lib/import/executionTime'
import { tradingViewUrl } from '~/lib/tradingview'
import {
  archivePlan,
  archivePosition,
  deletePosition,
  getPosition,
  reattachLeg,
  saveLegAnnotation,
  saveLegTime,
  updatePosition,
  type ActionResult,
  type LegView,
  type PositionDetail,
} from '~/server/playbook'

export const Route = createFileRoute('/_authed/playbook/$journalId')({
  component: Position,
  loader: ({ params }) => getPosition({ data: { id: params.journalId } }),
})

function ExtraTargets({ position }: { position: PositionDetail }) {
  if (position.extraTargets.length === 0) return null
  return (
    <Figure
      label="Extra targets"
      value={position.extraTargets.map((target) => (
        <span key={`${target.price}-${target.fraction}`} className={styles.block}>
          {priceText(target.price, position.currency)} · sell {target.fraction}
        </span>
      ))}
    />
  )
}

function PlanPanel({ position, onEdit }: { position: PositionDetail; onEdit: () => void }) {
  const archive = usePlaybookAction((id: string): Promise<ActionResult> => archivePlan({ data: { id } }))
  const view = position.planView
  const editButton = position.archived ? null : (
    <button type="button" className={styles.button} onClick={onEdit}>
      Edit plan
    </button>
  )

  if (view.kind === 'ARCHIVED') {
    return (
      <Section title="Exit plan" description="Archived. Its stop still gives this position its R.">
        <div className={figureStyles.figures}>
          <Figure label="Entry" value={priceText(view.entryPrice, position.currency)} />
          <Figure label="Support" value={priceText(view.supportLevel, position.currency)} />
          <Figure label="Initial stop" value={priceText(view.stop, position.currency)} />
          <Figure label="Target 1" value={priceText(view.target1, position.currency)} />
          <ExtraTargets position={position} />
        </div>
      </Section>
    )
  }

  if (view.kind === 'STATIC') {
    return (
      <Section
        title="Exit plan"
        description="A static plan: no feed, ladder, recommendation or push."
        actions={editButton}
      >
        {view.stop === null && view.target1 === null && position.extraTargets.length === 0 ? (
          <Empty>No plan recorded, so this position has no R.</Empty>
        ) : (
          <div className={figureStyles.figures}>
            <Figure label="Stop" value={priceText(view.stop, position.currency)} />
            <Figure label="Target 1" value={priceText(view.target1, position.currency)} />
            <ExtraTargets position={position} />
          </div>
        )}
      </Section>
    )
  }

  const { row } = view
  const finished = row.actionKind === 'POSITION_CLOSED' || row.actionKind === 'PLAN_SUPERSEDED'
  return (
    <Section title="Exit plan" actions={editButton}>
      <p className={cx(styles.message, styles[row.actionSeverity])}>{row.actionMessage}</p>
      <ExitFlags row={row} />
      <ExitLadder row={row} ends size="lg" />
      <LivePlanFigures
        row={row}
        stopMultiple={view.stopMultiple}
        targetMultiple={view.targetMultiple}
        target1Manual={view.target1Manual}
      >
        <ExtraTargets position={position} />
      </LivePlanFigures>
      <FrameworkNote {...position.framework} />
      {finished ? (
        <div className={styles.rowEnd}>
          <ConfirmButton
            size="small"
            title="Retire this exit plan"
            onConfirm={() => {
              archive.run(row.id)
            }}
          >
            Archive exit plan
          </ConfirmButton>
        </div>
      ) : null}
      {archive.problem ? <p role="alert">{archive.problem}</p> : null}
    </Section>
  )
}

function ScorePanel({ position }: { position: PositionDetail }) {
  const override = usePlaybookAction(
    (riskRatingOverride: number | null): Promise<ActionResult> =>
      updatePosition({ data: { id: position.id, riskRatingOverride } }),
  )
  const { currency } = position
  return (
    <Section title="Score" description="Entry, exit, risk and result at a quarter each, so process outweighs outcome three to one.">
      <div className={figureStyles.figures}>
        <Figure label="Overall" value={<ScoreText value={position.overall} provisional={position.provisional} />} />
        <Figure label="Entry" value={position.entryScore ?? '—'} />
        <Figure label="Exit" value={position.exitScore ?? '—'} />
        <Figure label="Risk" value={position.riskScore ?? '—'} hint={position.riskRatingOverride === null ? undefined : 'manual'} />
        <Figure
          label="Result"
          value={
            <span className={styles[tone(position.result)]}>
              <ResultText row={position} />
            </span>
          }
        />
        <Figure label="Risked" value={priceText(position.riskAmount, currency)} hint={position.riskPct === null ? 'no account size' : `${pct(position.riskPct)} of account`} />
        <Figure label="Size" value={position.sizePct === null ? '—' : pct(position.sizePct)} hint="of account" />
        <Figure label="Planned R" value={position.plannedR ?? '—'} />
        <Figure
          label="Actual R"
          value={rSigned(position.r)}
          hint={currency === 'USD' && position.r ? 'after both commissions' : undefined}
        />
      </div>
      {position.archived ? null : (
        <RatingInput
          label="Risk rating override"
          value={override.pending ? (override.pendingInput ?? null) : position.riskRatingOverride}
          onChange={(value) => {
            override.run(value)
          }}
        />
      )}
      {override.problem ? <p role="alert">{override.problem}</p> : null}
    </Section>
  )
}

function LegCard({ position, leg }: { position: PositionDetail; leg: LegView }) {
  const [note, setNote] = useState(leg.note)
  const [seen, setSeen] = useState(leg.note)
  if (leg.note !== seen) {
    setSeen(leg.note)
    setNote(leg.note)
  }
  const market = timedMarket(position.assetClass)
  const stored = leg.executedAt ? new Date(leg.executedAt) : null
  const [time, setTime] = useState(() => toTimeInput(leg.date, stored))

  const annotate = usePlaybookAction(
    (patch: { rating?: number | null; note?: string }): Promise<ActionResult> =>
      saveLegAnnotation({
        data: {
          journalId: position.id,
          legId: leg.annotationId,
          side: leg.side,
          date: leg.date,
          firstTradeId: leg.firstTradeId,
          ...patch,
        },
      }),
  )
  const saveTime = usePlaybookAction((executedAt: string | null): Promise<ActionResult> =>
    saveLegTime({ data: { journalId: position.id, firstTradeId: leg.firstTradeId ?? '', executedAt } }),
  )

  const side = leg.side === 'ENTRY' ? 'Entry' : 'Exit'
  const label = `${side} ${leg.date}`
  const resolved = resolveExecutedAt(leg.date, time)?.toISOString() ?? null
  const dirty = note.trim() !== leg.note.trim()

  return (
    <li className={styles.leg}>
      <div className={styles.legHead}>
        <span className={leg.side === 'ENTRY' ? styles.sideEntry : styles.sideExit}>{side}</span>
        <span>{leg.date}</span>
        {stored ? <span className={styles.muted}>{formatJst(stored)}</span> : null}
        <span className={styles.legFigures}>
          {qty(leg.quantity)} at {priceText(leg.averagePrice, position.currency)}
          {leg.fills > 1 ? ` · ${String(leg.fills)} fills` : ''}
        </span>
      </div>
      <RatingInput
        label={`${label} rating`}
        value={annotate.pendingInput?.rating !== undefined ? annotate.pendingInput.rating : leg.rating}
        disabled={position.archived}
        onChange={(rating) => {
          annotate.run({ rating })
        }}
      />
      <label className={styles.field}>
        <span className={styles.figureLabel}>Why{leg.noteFromMemos ? ' — from the trade’s memo' : ''}</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={note}
          disabled={position.archived}
          onChange={(event) => {
            setNote(event.target.value)
          }}
        />
      </label>
      {dirty ? (
        <div className={styles.rowEnd}>
          <button
            type="button"
            className={styles.button}
            disabled={annotate.pending}
            onClick={() => {
              annotate.run({ note: note.trim() })
            }}
          >
            Save note
          </button>
        </div>
      ) : null}
      {/* A time only fills fills that have none; a fill's own is changed on Trades. */}
      {market && leg.firstTradeId && !leg.allTimed ? (
        <div className={styles.timeRow}>
          <ExecutionTimeInput tradeDate={leg.date} market={market} value={time} label={label} onChange={setTime} />
          {/* Not hidden when it matches the time shown: that time is the first
              timed fill's, and giving it to the rest is the usual case. */}
          {resolved ? (
            <button
              type="button"
              className={styles.button}
              disabled={saveTime.pending}
              title="Fills it onto this leg's fills that have no time yet"
              onClick={() => {
                saveTime.run(resolved)
              }}
            >
              Save time
            </button>
          ) : null}
        </div>
      ) : null}
      {annotate.problem ?? saveTime.problem ? <p role="alert">{annotate.problem ?? saveTime.problem}</p> : null}
    </li>
  )
}

/** Annotations no leg claims. The owner's notes are never dropped silently. */
function Unattached({ position }: { position: PositionDetail }) {
  const reattach = usePlaybookAction(
    (input: { legId: string; firstTradeId: string; side: 'ENTRY' | 'EXIT'; date: string }): Promise<ActionResult> =>
      reattachLeg({ data: input }),
  )
  if (position.unattached.length === 0) return null
  // A leg holds one annotation; one it already has cannot take another.
  const targets = position.legs.filter((leg) => leg.firstTradeId !== null && leg.annotationId === null)
  return (
    <div className={styles.unattached}>
      <h3 className={styles.subTitle}>Unattached</h3>
      <p className={styles.muted}>These notes no longer match a leg, usually after Rakuten regrouped the fills.</p>
      <ul className={styles.legs}>
        {position.unattached.map((item) => (
          <li key={item.id} className={styles.leg}>
            <span>
              {item.side === 'ENTRY' ? 'Entry' : 'Exit'} {item.date}
              {item.rating === null ? '' : ` · rated ${String(item.rating)}`}
            </span>
            {item.note ? <p>{item.note}</p> : null}
            {targets.length > 0 ? (
              <label className={styles.field}>
                <span className={styles.figureLabel}>Reattach to</span>
                <select
                  className={styles.textarea}
                  value=""
                  onChange={(event) => {
                    const leg = targets.find((candidate) => candidate.firstTradeId === event.target.value)
                    if (leg?.firstTradeId) {
                      reattach.run({ legId: item.id, firstTradeId: leg.firstTradeId, side: leg.side, date: leg.date })
                    }
                  }}
                >
                  <option value="">Choose a leg…</option>
                  {targets.map((leg) => (
                    <option key={leg.firstTradeId} value={leg.firstTradeId ?? ''}>
                      {leg.side === 'ENTRY' ? 'Entry' : 'Exit'} {leg.date} · {qty(leg.quantity)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </li>
        ))}
      </ul>
      {reattach.problem ? <p role="alert">{reattach.problem}</p> : null}
    </div>
  )
}

function Review({ position }: { position: PositionDetail }) {
  const save = usePlaybookAction(
    (patch: { criteriaMet?: string[]; mistakes?: string[]; lessons?: string }): Promise<ActionResult> =>
      updatePosition({ data: { id: position.id, ...patch } }),
  )
  const [lessons, setLessons] = useState(position.lessons)
  const [draft, setDraft] = useState('')
  const criteria = position.setup?.criteria ?? []
  const disabled = position.archived
  const criteriaMet = save.pendingInput?.criteriaMet ?? position.criteriaMet
  const mistakes = save.pendingInput?.mistakes ?? position.mistakes
  return (
    <Section title="Review">
      {criteria.length > 0 ? (
        <fieldset className={styles.criteria} disabled={disabled}>
          <legend className={styles.figureLabel}>Which held at entry</legend>
          {criteria.map((criterion) => (
            <label key={criterion.id} className={styles.check}>
              <input
                type="checkbox"
                checked={criteriaMet.includes(criterion.id)}
                onChange={(event) => {
                  save.run({
                    criteriaMet: event.target.checked
                      ? [...criteriaMet, criterion.id]
                      : criteriaMet.filter((id) => id !== criterion.id),
                  })
                }}
              />
              {criterion.text}
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className={styles.field}>
        <span id="mistakes-label" className={styles.figureLabel}>
          Mistakes
        </span>
        <TagInput
          tags={mistakes}
          draft={draft}
          labelledBy="mistakes-label"
          placeholder="Chased, no stop, sized too big…"
          disabled={disabled}
          onChange={(mistakes) => {
            save.run({ mistakes })
          }}
          onDraftChange={setDraft}
        />
        {!disabled && position.mistakeSuggestions.length > 0 ? (
          <div className={styles.suggestions}>
            {position.mistakeSuggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                className={styles.suggestion}
                onClick={() => {
                  save.run({ mistakes: withDraft(mistakes, tag) })
                }}
              >
                + {tag}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <label className={styles.field}>
        <span className={styles.figureLabel}>Lessons</span>
        <textarea
          className={styles.textarea}
          rows={3}
          value={lessons}
          disabled={disabled}
          onChange={(event) => {
            setLessons(event.target.value)
          }}
        />
      </label>
      {lessons.trim() !== position.lessons.trim() ? (
        <div className={styles.rowEnd}>
          <button
            type="button"
            className={styles.button}
            disabled={save.pending}
            onClick={() => {
              save.run({ lessons: lessons.trim() })
            }}
          >
            Save lessons
          </button>
        </div>
      ) : null}
      {save.problem ? <p role="alert">{save.problem}</p> : null}
    </Section>
  )
}

function Position() {
  const initial = Route.useLoaderData()
  const { journalId } = Route.useParams()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<'PLAN' | 'POSITION' | 'LINK' | null>(null)
  const close = () => {
    setDialog(null)
  }

  const { data: position } = useQuery({
    queryKey: ['playbook', 'position', journalId],
    queryFn: () => getPosition({ data: { id: journalId } }),
    initialData: initial,
  })

  const leave = () => {
    void navigate({ to: '/playbook' })
  }
  const archive = usePlaybookAction((id: string): Promise<ActionResult> => archivePosition({ data: { id } }), leave)
  const remove = usePlaybookAction((id: string): Promise<ActionResult> => deletePosition({ data: { id } }), leave)

  if (!position) {
    return (
      <>
        <Link to="/playbook" className={styles.back}>
          ← Playbook
        </Link>
        <Empty>That position no longer exists.</Empty>
      </>
    )
  }

  const meta = [
    position.kind === 'PAPER' ? 'Paper' : (ACCOUNT_LABEL[position.accountType ?? ''] ?? ''),
    position.setupName ?? 'No setup',
    position.archived ? 'Archived' : null,
  ]
    .filter((part) => part)
    .join(' · ')
  /** Null for funds, which carry no ticker in any export. */
  const chart = tradingViewUrl(position.symbol, position.assetClass)

  return (
    <>
      <Link to="/playbook" className={styles.back}>
        ← Playbook
      </Link>
      <PageHeader title={`${position.symbol} ${position.name}`} meta={meta}>
        <StatusBadge status={position.status} />
        {chart ? (
          <a
            className={cx(styles.button, styles.chartLink)}
            href={chart}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${position.symbol} on TradingView in a new tab`}
          >
            Chart <ExternalIcon />
          </a>
        ) : null}
        {position.archived ? null : (
          <>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setDialog('POSITION')
              }}
            >
              Edit
            </button>
            <ConfirmButton
              size="small"
              title="Hide it from the Playbook and archive its live exit plan. The trades stay in Trades."
              onConfirm={() => {
                archive.run(position.id)
              }}
            >
              Archive
            </ConfirmButton>
          </>
        )}
        <ConfirmButton
          size="small"
          title="Remove the position with its notes, ratings and chart images. The trades stay in Trades."
          onConfirm={() => {
            remove.run(position.id)
          }}
        >
          Delete
        </ConfirmButton>
      </PageHeader>

      {archive.problem ?? remove.problem ? <p role="alert">{archive.problem ?? remove.problem}</p> : null}

      {position.status === 'AWAITING_IMPORT' && position.candidates.length > 0 ? (
        <div className={styles.prompt}>
          <span>Matching trades have been imported.</span>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              setDialog('LINK')
            }}
          >
            Link imported trades
          </button>
        </div>
      ) : null}
      {position.status === 'MISSING' ? (
        <div className={styles.prompt}>
          <span>This position cannot find its trades. Nothing has been guessed.</span>
          {position.candidates.length > 0 ? (
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setDialog('LINK')
              }}
            >
              Relink
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={styles.columns}>
        <PlanPanel
          position={position}
          onEdit={() => {
            setDialog('PLAN')
          }}
        />
        <ScorePanel position={position} />
      </div>

      <PositionCharts
        journalId={position.id}
        images={position.images}
        enabled={position.imagesEnabled}
        archived={position.archived}
      />

      <Section title="Legs" description="One leg per side and day: one order filled as several executions is one decision.">
        {position.legs.length === 0 ? (
          <Empty>No legs to show.</Empty>
        ) : (
          <ul className={styles.legs}>
            {position.legs.map((leg) => (
              <LegCard key={`${leg.side}-${leg.date}-${leg.firstTradeId ?? leg.annotationId ?? ''}`} position={position} leg={leg} />
            ))}
          </ul>
        )}
        <Unattached position={position} />
      </Section>

      <Review key={position.id} position={position} />

      {dialog === 'PLAN' ? <EditPlanDialog position={position} onClose={close} /> : null}
      {dialog === 'POSITION' ? <EditPositionDialog position={position} onClose={close} /> : null}
      {dialog === 'LINK' ? <LinkDialog position={position} onClose={close} /> : null}
    </>
  )
}
