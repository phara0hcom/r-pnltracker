/**
 * One review: the play, the plan and risk, each entry and exit with its
 * rating and charts, and what to take from it.
 *
 * The form is edited locally and saved as one document; the score and every
 * figure beside it are the server's, from the last save, so the screen never
 * does the arithmetic itself. Charts are captured per leg and saved on their
 * own — they are kept out of the form, so capturing one does not discard
 * unsaved edits.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import styles from './review.module.scss'
import { toFieldErrors } from '~/components/exits/fieldErrors'
import { ACCOUNT_LABEL, money, moneySigned, pct, pctSigned, tone } from '~/components/format'
import type { ChartLevel } from '~/components/playbook/CandleChart'
import { formatPrice } from '~/components/playbook/formatPrice'
import { LegCard, type LegForm } from '~/components/playbook/LegCard'
import { RatingInput } from '~/components/playbook/RatingInput'
import { PageHeader, Section } from '~/components/screen'
import { FormField } from '~/components/trades/FormField'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { TagInput, withDraft } from '~/components/ui/TagInput'
import { cx } from '~/lib/cx'
import { todayLocal } from '~/lib/localDate'
import { reportError } from '~/lib/observability/report'
import { zoneOf } from '~/lib/playbook/candles'
import type { LegKind } from '~/lib/playbook/types'
import { deleteReviewFn, getReviewDetail, saveReviewFn, type ReviewDetail } from '~/server/playbook'

export const Route = createFileRoute('/_authed/playbook/$reviewId')({
  component: Review,
  loader: ({ params }) => getReviewDetail({ data: { id: params.reviewId } }),
})

interface Form {
  playbookId: string
  stopPrice: string
  targetPrice: string
  accountEquity: string
  riskRatingOverride: number | null
  criteriaMet: string[]
  mistakes: string[]
  mistakeDraft: string
  lessons: string
  legs: LegForm[]
}

const fromDetail = (detail: ReviewDetail): Form => ({
  playbookId: detail.playbookId ?? '',
  stopPrice: detail.stopPrice ?? '',
  targetPrice: detail.targetPrice ?? '',
  accountEquity: detail.accountEquity ?? '',
  riskRatingOverride: detail.riskRatingOverride,
  criteriaMet: detail.criteriaMet,
  mistakes: detail.mistakes,
  mistakeDraft: '',
  lessons: detail.lessons,
  legs: detail.legs.map((leg) => ({
    key: leg.id,
    id: leg.id,
    kind: leg.kind,
    tradeId: leg.tradeId,
    tradeMissing: leg.tradeMissing,
    date: leg.date,
    time: leg.time ?? '',
    price: leg.price,
    quantity: leg.quantity,
    fee: leg.fee,
    rating: leg.rating,
    explanation: leg.explanation,
  })),
})

const COMPONENT_LABEL = { entry: 'Entry', exit: 'Exit', risk: 'Risk', outcome: 'Result' } as const

const score = (value: number | null) => (value === null ? '—' : value.toFixed(1))

function Review() {
  const initial = Route.useLoaderData()
  const { reviewId } = Route.useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const queryKey = ['playbook-review', reviewId]
  const { data, refetch } = useQuery({
    queryKey,
    queryFn: () => getReviewDetail({ data: { id: reviewId } }),
    initialData: initial,
  })

  const [form, setForm] = useState<Form>(() => fromDetail(data))
  const [seededFor, setSeededFor] = useState(data.id)
  const [errors, setErrors] = useState<Record<string, string>>({})
  if (seededFor !== data.id) {
    setSeededFor(data.id)
    setForm(fromDetail(data))
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(fromDetail(data))
  const { currency } = data
  const zone = zoneOf(data.assetClass)
  const playbook = data.playbooks.find((candidate) => candidate.id === form.playbookId) ?? null
  const figures = data.figures

  /** Keys for legs added since the last save, which have no id yet. */
  const added = useRef(0)

  const save = useMutation({
    mutationFn: () =>
      saveReviewFn({
        data: {
          id: data.id,
          playbookId: form.playbookId === '' ? null : form.playbookId,
          stopPrice: form.stopPrice,
          targetPrice: form.targetPrice,
          accountEquity: form.accountEquity,
          riskRatingOverride: form.riskRatingOverride,
          criteriaMet: form.criteriaMet.filter(
            (criterion) => playbook?.criteria.includes(criterion) ?? false,
          ),
          mistakes: withDraft(form.mistakes, form.mistakeDraft),
          lessons: form.lessons,
          legs: form.legs.map((leg) => ({
            id: leg.id,
            kind: leg.kind,
            tradeId: leg.tradeId,
            date: leg.date,
            time: leg.time,
            price: leg.price,
            quantity: leg.quantity,
            fee: leg.fee,
            rating: leg.rating,
            explanation: leg.explanation,
          })),
        },
      }),
    onSuccess: async () => {
      setErrors({})
      const { data: fresh } = await refetch()
      if (fresh) setForm(fromDetail(fresh))
      void queryClient.invalidateQueries({ queryKey: ['playbook-screen'] })
    },
    onError: (error: unknown) => {
      reportError(error, { mutation: 'saveReview' })
      setErrors(toFieldErrors(error))
    },
  })

  const remove = useMutation({
    mutationFn: () => deleteReviewFn({ data: { id: data.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playbook-screen'] })
      await navigate({ to: '/playbook' })
    },
  })

  const setLeg = (key: string, leg: LegForm) => {
    setForm({ ...form, legs: form.legs.map((old) => (old.key === key ? leg : old)) })
  }

  const addPaperLeg = (kind: LegKind) => {
    added.current += 1
    setForm({
      ...form,
      legs: [
        ...form.legs,
        {
          key: `new-${String(added.current)}`,
          kind,
          tradeId: null,
          tradeMissing: false,
          date: todayLocal(),
          time: '',
          price: '',
          quantity: '',
          fee: '0',
          rating: null,
          explanation: '',
        },
      ],
    })
  }

  const linkedIds = new Set(form.legs.map((leg) => leg.tradeId))
  const candidates = data.candidates.filter((trade) => !linkedIds.has(trade.id))

  const addTrade = (id: string) => {
    const trade = data.candidates.find((candidate) => candidate.id === id)
    if (!trade) return
    setForm({
      ...form,
      legs: [
        ...form.legs,
        {
          key: trade.id,
          kind: trade.kind,
          tradeId: trade.id,
          tradeMissing: false,
          date: trade.date,
          time: '',
          price: trade.price,
          quantity: trade.quantity,
          fee: '0',
          rating: null,
          explanation: '',
        },
      ],
    })
  }

  const levels: ChartLevel[] = [
    ...(data.stopPrice ? [{ label: 'Stop', value: data.stopPrice, kind: 'stop' as const }] : []),
    ...(data.targetPrice
      ? [{ label: 'Target', value: data.targetPrice, kind: 'target' as const }]
      : []),
    ...(figures.avgEntry
      ? [{ label: 'Avg entry', value: figures.avgEntry, kind: 'entry' as const }]
      : []),
  ]
  const tvIntervals = data.tvIntervals.map((row) => row.interval)
  const chartsFor = (id: string | undefined) => data.legs.find((leg) => leg.id === id)?.charts ?? []

  const legSection = (kind: LegKind) => {
    const legs = form.legs.filter((leg) => leg.kind === kind)
    const options = candidates.filter((trade) => trade.kind === kind)
    const noun = kind === 'ENTRY' ? 'entry' : 'exit'
    return (
      <Section
        title={kind === 'ENTRY' ? 'Entries' : 'Exits'}
        description={
          kind === 'ENTRY'
            ? 'Rate the setup at each entry, not how it turned out. A scale-in is its own entry.'
            : 'Rate the decision to leave — was it the plan, and was the plan right? A partial is its own exit.'
        }
        actions={
          data.kind === 'PAPER' ? (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                addPaperLeg(kind)
              }}
            >
              + Add {noun}
            </button>
          ) : options.length > 0 ? (
            <select
              className={styles.inlineSelect}
              aria-label={`Add a ${kind === 'ENTRY' ? 'buy' : 'sell'} as an ${noun}`}
              value=""
              onChange={(event) => {
                addTrade(event.target.value)
              }}
            >
              <option value="">+ Add {kind === 'ENTRY' ? 'a buy' : 'a sell'}…</option>
              {options.map((trade) => (
                <option key={trade.id} value={trade.id}>
                  {trade.date} · {trade.quantity} @ {formatPrice(trade.price, currency)}
                </option>
              ))}
            </select>
          ) : null
        }
      >
        <div className={styles.legs}>
          {legs.length === 0 ? <p className={styles.muted}>No {noun} yet.</p> : null}
          {legs.map((leg) => (
            <LegCard
              key={leg.key}
              leg={leg}
              currency={currency}
              charts={chartsFor(leg.id)}
              levels={levels}
              zone={zone}
              tvIntervals={tvIntervals}
              onChange={(next) => {
                setLeg(leg.key, next)
              }}
              onRemove={() => {
                setForm({ ...form, legs: form.legs.filter((old) => old.key !== leg.key) })
              }}
              onChartsChanged={() => {
                void refetch()
              }}
            />
          ))}
        </div>
      </Section>
    )
  }

  const unit = currency === 'JPY' ? '¥' : '$'

  return (
    <>
      <PageHeader
        title={`${data.symbol} ${data.name}`.trim()}
        meta={
          <>
            <Link to="/playbook" className={styles.back}>
              ← Playbook
            </Link>{' '}
            ·{' '}
            {data.kind === 'PAPER'
              ? 'Paper trade'
              : (ACCOUNT_LABEL[data.accountType ?? ''] ?? data.accountType)}
            {figures.open ? ' · open' : ''}
          </>
        }
      >
        <ConfirmButton
          onConfirm={() => {
            remove.mutate()
          }}
          confirmLabel="Delete review?"
        >
          Delete
        </ConfirmButton>
        <button
          type="button"
          className={cx(styles.save, save.isPending && styles.busy)}
          disabled={!dirty || save.isPending}
          onClick={() => {
            save.mutate()
          }}
        >
          {save.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </PageHeader>

      {errors.form || Object.keys(errors).length > 0 ? (
        <p className={styles.formError} role="alert">
          {errors.form ??
            Object.entries(errors)
              .map(([field, message]) => `${field}: ${message}`)
              .join(' · ')}
        </p>
      ) : null}

      <section className={styles.scoreCard} aria-label="Score">
        <div className={styles.overall}>
          <span className={styles.overallValue}>{score(figures.overall)}</span>
          <span className={styles.overallOf}>/ 10</span>
          {figures.provisional && figures.overall !== null ? (
            <span className={styles.provisional}>provisional</span>
          ) : null}
          {dirty ? <span className={styles.muted}>Save to update</span> : null}
        </div>
        <ul className={styles.components}>
          {(['entry', 'exit', 'risk', 'outcome'] as const).map((key) => {
            const part = figures.components.find((component) => component.key === key)
            return (
              <li key={key} className={cx(!part && styles.missing)}>
                <span className={styles.componentLabel}>{COMPONENT_LABEL[key]}</span>
                <span className={styles.componentValue}>{part ? score(part.score) : '—'}</span>
                <span className={styles.componentWeight}>
                  {part ? pct(part.weight, 0) : 'not counted'}
                </span>
              </li>
            )
          })}
        </ul>
        <dl className={styles.figures}>
          <div>
            <dt>Result</dt>
            <dd className={styles[tone(figures.pnl)]}>
              {figures.pnl === null ? '—' : moneySigned(figures.pnl, currency)}
              {figures.returnPct !== null ? ` (${pctSigned(figures.returnPct)})` : ''}
            </dd>
          </div>
          <div>
            <dt>R multiple</dt>
            <dd className={styles[tone(figures.rMultiple)]}>
              {figures.rMultiple === null ? '—' : `${figures.rMultiple}R`}
            </dd>
          </div>
          <div>
            <dt>Planned R</dt>
            <dd>{figures.plannedR === null ? '—' : `${figures.plannedR}R`}</dd>
          </div>
          <div>
            <dt>Risked</dt>
            <dd>
              {figures.riskAmount === null ? '—' : money(figures.riskAmount, currency)}
              {figures.riskPct !== null ? ` · ${pct(figures.riskPct, 2)} of account` : ''}
            </dd>
          </div>
          <div>
            <dt>Position size</dt>
            <dd>{figures.sizePct === null ? '—' : `${pct(figures.sizePct, 1)} of account`}</dd>
          </div>
          <div>
            <dt>Avg entry → exit</dt>
            <dd>
              {formatPrice(figures.avgEntry, currency)} → {formatPrice(figures.avgExit, currency)}
            </dd>
          </div>
        </dl>
      </section>

      <Section
        title="Play & risk"
        description="The stop is what one R is measured from; account size turns it into the share of the account at risk."
      >
        <div className={styles.grid}>
          <FormField label="Playbook" error={errors.playbookId}>
            <select
              className={styles.input}
              value={form.playbookId}
              onChange={(event) => {
                setForm({ ...form, playbookId: event.target.value })
              }}
            >
              <option value="">No playbook</option>
              {data.playbooks
                .filter((candidate) => !candidate.archived || candidate.id === form.playbookId)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
            </select>
          </FormField>
          <FormField label={`Initial stop (${unit})`} error={errors.stopPrice}>
            <input
              className={styles.input}
              inputMode="decimal"
              value={form.stopPrice}
              onChange={(event) => {
                setForm({ ...form, stopPrice: event.target.value })
              }}
            />
          </FormField>
          <FormField label={`Target (${unit})`} error={errors.targetPrice}>
            <input
              className={styles.input}
              inputMode="decimal"
              value={form.targetPrice}
              onChange={(event) => {
                setForm({ ...form, targetPrice: event.target.value })
              }}
            />
          </FormField>
          <FormField
            label={`Account size (${unit})`}
            error={errors.accountEquity}
            hint="When the trade was opened"
          >
            <input
              className={styles.input}
              inputMode="decimal"
              value={form.accountEquity}
              onChange={(event) => {
                setForm({ ...form, accountEquity: event.target.value })
              }}
            />
          </FormField>
        </div>

        <div className={styles.riskRow}>
          <span className={styles.label}>Risk rating</span>
          <RatingInput
            label="Risk rating override"
            value={form.riskRatingOverride}
            onChange={(value) => {
              setForm({ ...form, riskRatingOverride: value })
            }}
          />
          <span className={styles.muted}>
            {figures.riskRatingAuto === null
              ? 'Set a stop and account size to compute one.'
              : `Computed ${score(figures.riskRatingAuto)} from risk and size.`}{' '}
            Pick a number only to overrule it.
          </span>
        </div>

        {playbook && playbook.criteria.length > 0 ? (
          <fieldset className={styles.checklist}>
            <legend className={styles.label}>Criteria that held at entry</legend>
            {playbook.criteria.map((criterion) => (
              <label key={criterion} className={styles.check}>
                <input
                  type="checkbox"
                  checked={form.criteriaMet.includes(criterion)}
                  onChange={(event) => {
                    setForm({
                      ...form,
                      criteriaMet: event.target.checked
                        ? [...form.criteriaMet, criterion]
                        : form.criteriaMet.filter((kept) => kept !== criterion),
                    })
                  }}
                />
                {criterion}
              </label>
            ))}
          </fieldset>
        ) : null}
      </Section>

      {legSection('ENTRY')}
      {legSection('EXIT')}

      <Section
        title="Lessons"
        description="What to repeat, what to stop doing. Mistake tags are counted across reviews."
      >
        <div className={styles.lessons}>
          <span id="mistakes-label" className={styles.label}>
            Mistakes
          </span>
          <TagInput
            tags={form.mistakes}
            draft={form.mistakeDraft}
            labelledBy="mistakes-label"
            placeholder={
              data.knownMistakes.length > 0
                ? `e.g. ${data.knownMistakes.slice(0, 3).join(', ')}`
                : 'FOMO entry, moved stop, sold early'
            }
            onChange={(mistakes) => {
              setForm({ ...form, mistakes })
            }}
            onDraftChange={(mistakeDraft) => {
              setForm({ ...form, mistakeDraft })
            }}
          />
          <FormField label="Notes">
            <textarea
              className={cx(styles.input, styles.textarea)}
              value={form.lessons}
              onChange={(event) => {
                setForm({ ...form, lessons: event.target.value })
              }}
              placeholder="What I would do differently"
            />
          </FormField>
        </div>
      </Section>

      {data.tvTicker ? (
        <p className={styles.muted}>
          Charts come from the TradingView alert when it has sent that timeframe for{' '}
          <code>{data.tvTicker}</code>
          {data.tvIntervals.length > 0
            ? ` (${data.tvIntervals.map((row) => `${row.interval}: ${String(row.bars)} bars`).join(', ')})`
            : ' (none yet)'}
          , and from Yahoo otherwise.
          {data.webhookConfigured
            ? ''
            : ' The webhook secret is not configured, so no alert can deliver yet.'}{' '}
          See <code>docs/playbook.md</code>.
        </p>
      ) : null}
    </>
  )
}
