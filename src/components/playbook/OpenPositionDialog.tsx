/**
 * Open a position: source, setup, images, exit plan.
 *
 * The three sources are the three times a position can be filed — over a holding,
 * at buy time before the export exists, or after the fact over a closed streak.
 * From scratch is deliberately not a manual trade: that would enter the engine at
 * once and be salted so no import could match it, so the later export would add
 * the same fill twice.
 *
 * A holding's candidate is held by its anchor id, not its place in the list, since
 * the options refetch while the dialog sits open and an index could come to mean a
 * different position between picking one and submitting.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import styles from './Dialog.module.scss'
import { FrameworkNote, PlanInputs, PlanPreview, target1OverrideOf, type PlanForm } from './PlanFields'
import { usePlaybookAction } from './usePlaybookAction'
import { ACCOUNT_LABEL, priceText, qty } from '~/components/format'
import { ExecutionTimeInput } from '~/components/trades/ExecutionTimeInput'
import { FormField } from '~/components/trades/FormField'
import { useDialogHistory } from '~/components/ui/useDialogHistory'
import { useToday } from '~/components/ui/useToday'
import { cx } from '~/lib/cx'
import type { AccountType } from '~/lib/domain/types'
import { EMPTY_TIME, resolveExecutedAt, type TimeInput } from '~/lib/import/executionTime'
import type { OpenPositionData } from '~/lib/playbook/schemas'
import {
  createSetupInline,
  getOpenOptions,
  openPosition,
  type OpenOptions,
  type StreakCandidate,
} from '~/server/playbook'

type Source = OpenPositionData['source']

const STEPS = ['Source', 'Setup', 'Images', 'Exit plan'] as const

const ACCOUNTS: AccountType[] = ['SPECIFIC', 'NISA_GROWTH', 'NISA_TSUMITATE', 'NISA_OLD']

interface Scratch {
  symbol: string
  name: string
  market: 'JP' | 'US'
  accountType: AccountType
  paper: boolean
  time: TimeInput
}

interface Entry {
  date: string
  price: string
  shares: string
}

const blankScratch: Scratch = {
  symbol: '',
  name: '',
  market: 'JP',
  accountType: 'SPECIFIC',
  paper: false,
  time: EMPTY_TIME,
}

const blankPlan = (options: OpenOptions | undefined): PlanForm => ({
  supportLevel: '',
  stopMultiple: options?.defaults.stopMultiple ?? '',
  targetMultiple: options?.defaults.targetMultiple ?? '',
  targetManual: false,
  target1: '',
  extraTargets: [],
  trailingMethod: '',
  note: '',
})

function CandidateList({
  legend,
  candidates,
  chosen,
  onChoose,
  empty,
}: {
  legend: string
  candidates: StreakCandidate[]
  chosen: string | null
  onChoose: (candidate: StreakCandidate) => void
  empty: string
}) {
  if (candidates.length === 0) return <p className={styles.note}>{empty}</p>
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.choices}>
        {candidates.map((candidate) => (
          <label key={candidate.anchorTradeId} className={styles.choice}>
            <input
              type="radio"
              name="streak"
              checked={chosen === candidate.anchorTradeId}
              onChange={() => {
                onChoose(candidate)
              }}
            />
            <span className={styles.choiceMain}>
              {candidate.symbol} {candidate.name}
              <span className={styles.choiceMeta}>
                {ACCOUNT_LABEL[candidate.accountType] ?? candidate.accountType} · {candidate.entryDate}
                {candidate.closeDate ? ` → ${candidate.closeDate}` : ''} · {qty(candidate.shares)} at{' '}
                {priceText(candidate.entryPrice, candidate.currency)}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Step 2's inline form. A setup has only a name, a description and its criteria. */
function NewSetup({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [criteria, setCriteria] = useState('')
  const create = usePlaybookAction(
    () =>
      createSetupInline({
        data: {
          name,
          description,
          criteria: criteria
            .split('\n')
            .map((text) => ({ text: text.trim() }))
            .filter((criterion) => criterion.text !== ''),
        },
      }),
    (result) => {
      onCreated(result.id)
    },
  )
  return (
    <div className={styles.form}>
      <FormField label="Name">
        <input
          className={styles.input}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
      </FormField>
      <FormField label="Description">
        <input
          className={styles.input}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value)
          }}
        />
      </FormField>
      <FormField label="Entry criteria" hint="One per line — ticked on each position">
        <textarea
          className={styles.textarea}
          value={criteria}
          onChange={(event) => {
            setCriteria(event.target.value)
          }}
        />
      </FormField>
      {create.problem ? (
        <p className={styles.formError} role="alert">
          {create.problem}
        </p>
      ) : null}
      <div>
        <button
          type="button"
          className={cx(styles.secondary, styles.small)}
          disabled={create.pending || name.trim() === ''}
          onClick={() => {
            create.run(undefined)
          }}
        >
          {create.pending ? 'Creating…' : 'Create setup'}
        </button>
      </div>
    </div>
  )
}

export function OpenPositionDialog({
  open,
  onOpenChange,
  onOpened,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A position with no alert to add goes straight to its page. */
  onOpened: (id: string) => void
}) {
  useDialogHistory(open, () => {
    onOpenChange(false)
  })
  const today = useToday()
  const options = useQuery({ queryKey: ['playbook', 'options'], queryFn: () => getOpenOptions(), enabled: open })

  const [step, setStep] = useState(0)
  const [source, setSource] = useState<Source>('HOLDING')
  const [anchor, setAnchor] = useState<string | null>(null)
  const [scratch, setScratch] = useState<Scratch>(blankScratch)
  const [entry, setEntry] = useState<Entry>({ date: '', price: '', shares: '' })
  const [setupId, setSetupId] = useState('')
  const [creatingSetup, setCreatingSetup] = useState(false)
  const [plan, setPlan] = useState<PlanForm>(() => blankPlan(undefined))
  const [wantsStatic, setWantsStatic] = useState(true)
  const [equity, setEquity] = useState<string | null>(null)
  const [created, setCreated] = useState<{ id: string; symbol: string } | null>(null)

  // Re-seed on open rather than in an effect, as the exit forms do.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStep(0)
      setSource('HOLDING')
      setAnchor(null)
      setScratch(blankScratch)
      setEntry({ date: today ?? '', price: '', shares: '' })
      setSetupId('')
      setCreatingSetup(false)
      setPlan(blankPlan(options.data))
      setWantsStatic(true)
      setEquity(null)
      setCreated(null)
    }
  }

  const defaults = options.data?.defaults
  // Filled in once the options arrive, unless already typed over.
  if (defaults && plan.stopMultiple === '' && plan.targetMultiple === '') {
    setPlan({ ...plan, stopMultiple: defaults.stopMultiple, targetMultiple: defaults.targetMultiple })
  }

  const list = source === 'PAST' ? (options.data?.pastTrades ?? []) : (options.data?.holdings ?? [])
  const picked = source === 'SCRATCH' ? null : (list.find((item) => item.anchorTradeId === anchor) ?? null)
  const market = picked?.market ?? scratch.market
  const currency = market === 'US' ? 'USD' : 'JPY'
  const unit = currency === 'USD' ? '$' : '¥'
  const symbol = picked?.symbol ?? scratch.symbol.trim().toUpperCase()
  const paper = source === 'SCRATCH' && scratch.paper
  const live = !paper && source !== 'PAST'
  // Optional on paper and a past trade; a live plan is what a held position is for.
  const planOptional = !live
  const accountEquity = equity ?? defaults?.accountEquity[currency] ?? ''

  const choose = (candidate: StreakCandidate) => {
    setAnchor(candidate.anchorTradeId)
    setEntry({ date: candidate.entryDate, price: candidate.entryPrice, shares: candidate.shares })
    const prefill = candidate.prefill
    setPlan({
      ...plan,
      supportLevel: prefill?.supportLevel ?? '',
      stopMultiple: prefill?.stopMultiple ?? defaults?.stopMultiple ?? '',
      targetMultiple: prefill?.targetMultiple ?? defaults?.targetMultiple ?? '',
      targetManual: prefill?.target1Override != null,
      target1: prefill?.target1Override ?? '',
    })
    setEquity(null)
  }

  const changeSource = (next: Source) => {
    setSource(next)
    setAnchor(null)
    setEntry({ date: next === 'SCRATCH' ? (today ?? '') : '', price: '', shares: '' })
  }

  const sourceReady =
    (source === 'SCRATCH' ? symbol !== '' : picked !== null) &&
    entry.date !== '' &&
    entry.price.trim() !== '' &&
    entry.shares.trim() !== ''

  const hasPlan = live || (wantsStatic && plan.supportLevel.trim() !== '')

  const submit = usePlaybookAction(
    () => {
      const executedAt =
        source === 'SCRATCH' && entry.date !== '' ? resolveExecutedAt(entry.date, scratch.time)?.toISOString() : null
      return openPosition({
        data: {
          source,
          paper,
          setupId,
          symbol,
          name: picked?.name ?? scratch.name.trim(),
          market,
          accountType: paper ? null : (picked?.accountType ?? scratch.accountType),
          entryDate: entry.date,
          entryPrice: entry.price.trim(),
          shares: entry.shares.trim(),
          executedAt: executedAt ?? null,
          anchorTradeId: picked?.anchorTradeId ?? null,
          plan: hasPlan
            ? {
                supportLevel: plan.supportLevel.trim(),
                stopMultiple: plan.stopMultiple.trim(),
                targetMultiple: plan.targetMultiple.trim(),
                target1Override: target1OverrideOf(plan),
                trailingMethod: plan.trailingMethod === '' ? null : plan.trailingMethod,
                note: plan.note.trim() === '' ? null : plan.note.trim(),
              }
            : null,
          extraTargets: plan.extraTargets,
          accountEquity: accountEquity.trim() === '' ? null : accountEquity.trim(),
        },
      })
    },
    (result) => {
      if (result.live) {
        // The server's: the refetch this triggers drops the streak just claimed,
        // so the form's own `symbol` falls back to the blank scratch field.
        setCreated({ id: result.id, symbol: result.symbol })
      } else {
        onOpenChange(false)
        onOpened(result.id)
      }
    },
  )

  const entryFields = (
    <div className={styles.row}>
      <FormField label="Entry date">
        <input
          className={styles.input}
          type="date"
          value={entry.date}
          onChange={(event) => {
            setEntry({ ...entry, date: event.target.value })
          }}
        />
      </FormField>
      <FormField label={`Entry price (${unit})`}>
        <input
          className={styles.input}
          inputMode="decimal"
          value={entry.price}
          onChange={(event) => {
            setEntry({ ...entry, price: event.target.value })
          }}
        />
      </FormField>
      <FormField label="Shares">
        <input
          className={styles.input}
          inputMode="decimal"
          value={entry.shares}
          onChange={(event) => {
            setEntry({ ...entry, shares: event.target.value })
          }}
        />
      </FormField>
    </div>
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>Open position</Dialog.Title>
          {created ? (
            <>
              <Dialog.Description className={styles.description}>
                Position opened. Add a TradingView alert for {created.symbol} — alerts are per symbol, and without one the plan
                reads as stale. See <code>docs/exit-rules.md</code> §1.3.
              </Dialog.Description>
              <div className={styles.footer}>
                <Link
                  to="/playbook/$journalId"
                  params={{ journalId: created.id }}
                  className={styles.primary}
                  onClick={() => {
                    onOpenChange(false)
                  }}
                >
                  Go to the position
                </Link>
              </div>
            </>
          ) : (
            <>
              <Dialog.Description className={styles.description}>
                A position is one swing trade from open to close, filed under a setup.
              </Dialog.Description>
              <ol className={styles.steps}>
                {STEPS.map((name, index) => (
                  <li
                    key={name}
                    className={cx(styles.step, index < step && styles.stepDone, index === step && styles.stepCurrent)}
                    aria-current={index === step ? 'step' : undefined}
                  >
                    {name}
                  </li>
                ))}
              </ol>

              {step === 0 ? (
                <div className={styles.form}>
                  <fieldset className={styles.fieldset}>
                    <legend className={styles.legend}>Where it comes from</legend>
                    <div className={styles.row}>
                      {(
                        [
                          ['HOLDING', 'A current holding'],
                          ['SCRATCH', 'New, from scratch'],
                          ['PAST', 'A past trade'],
                        ] as const
                      ).map(([value, label]) => (
                        <label key={value} className={styles.choice}>
                          <input
                            type="radio"
                            name="source"
                            checked={source === value}
                            onChange={() => {
                              changeSource(value)
                            }}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  {source === 'HOLDING' ? (
                    <>
                      <CandidateList
                        legend="Open holdings not yet in the Playbook"
                        candidates={options.data?.holdings ?? []}
                        chosen={anchor}
                        onChoose={choose}
                        empty={options.isPending ? 'Loading…' : 'Every open holding is already in the Playbook.'}
                      />
                      {picked ? entryFields : null}
                    </>
                  ) : null}

                  {source === 'PAST' ? (
                    <>
                      <CandidateList
                        legend="Closed trades not yet in the Playbook, newest first"
                        candidates={options.data?.pastTrades ?? []}
                        chosen={anchor}
                        onChoose={choose}
                        empty={options.isPending ? 'Loading…' : 'Every closed trade is already in the Playbook.'}
                      />
                      {picked?.prefill ? (
                        <p className={styles.note}>The stop comes from the archived exit plan over this trade.</p>
                      ) : null}
                    </>
                  ) : null}

                  {source === 'SCRATCH' ? (
                    <>
                      <p className={styles.note}>
                        Bought, not exported yet. Nothing reaches your figures until the real trades are imported and
                        linked.
                      </p>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={scratch.paper}
                          onChange={(event) => {
                            setScratch({ ...scratch, paper: event.target.checked })
                          }}
                        />
                        Paper trade — never reaches any figure outside the Playbook
                      </label>
                      <div className={styles.row}>
                        <FormField label="Market">
                          <select
                            className={styles.input}
                            value={scratch.market}
                            onChange={(event) => {
                              setScratch({ ...scratch, market: event.target.value as 'JP' | 'US', time: EMPTY_TIME })
                            }}
                          >
                            <option value="JP">JP</option>
                            <option value="US">US</option>
                          </select>
                        </FormField>
                        <FormField label="Symbol" hint={scratch.market === 'JP' ? 'A code, like 7203' : 'A ticker, like AAPL'}>
                          <input
                            className={styles.input}
                            value={scratch.symbol}
                            onChange={(event) => {
                              setScratch({ ...scratch, symbol: event.target.value })
                            }}
                          />
                        </FormField>
                        <FormField label="Name" hint="An import corrects it">
                          <input
                            className={styles.input}
                            value={scratch.name}
                            onChange={(event) => {
                              setScratch({ ...scratch, name: event.target.value })
                            }}
                          />
                        </FormField>
                        {scratch.paper ? null : (
                          <FormField label="Account">
                            <select
                              className={styles.input}
                              value={scratch.accountType}
                              onChange={(event) => {
                                setScratch({ ...scratch, accountType: event.target.value as AccountType })
                              }}
                            >
                              {ACCOUNTS.map((account) => (
                                <option key={account} value={account}>
                                  {ACCOUNT_LABEL[account]}
                                </option>
                              ))}
                            </select>
                          </FormField>
                        )}
                      </div>
                      {entryFields}
                      <div className={styles.fixed}>
                        <span>Time (JST), optional</span>
                        <ExecutionTimeInput
                          tradeDate={entry.date}
                          market={scratch.market}
                          value={scratch.time}
                          label={`the buy of ${symbol || 'this position'}`}
                          onChange={(time) => {
                            setScratch({ ...scratch, time })
                          }}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}

              {step === 1 ? (
                <div className={styles.form}>
                  <fieldset className={styles.fieldset}>
                    <legend className={styles.legend}>Which type of play this was</legend>
                    <div className={styles.choices}>
                      {(options.data?.setups ?? []).map((setup) => (
                        <label key={setup.id} className={styles.choice}>
                          <input
                            type="radio"
                            name="setup"
                            checked={setupId === setup.id && !creatingSetup}
                            onChange={() => {
                              setSetupId(setup.id)
                              setCreatingSetup(false)
                            }}
                          />
                          <span className={styles.choiceMain}>
                            {setup.name}
                            {setup.description ? <span className={styles.choiceMeta}>{setup.description}</span> : null}
                          </span>
                        </label>
                      ))}
                      <label className={styles.choice}>
                        <input
                          type="radio"
                          name="setup"
                          checked={creatingSetup}
                          onChange={() => {
                            setCreatingSetup(true)
                            setSetupId('')
                          }}
                        />
                        Create a new setup
                      </label>
                    </div>
                  </fieldset>
                  {creatingSetup ? (
                    <NewSetup
                      onCreated={(id) => {
                        setSetupId(id)
                        setCreatingSetup(false)
                      }}
                    />
                  ) : null}
                </div>
              ) : null}

              {step === 2 ? (
                <p className={styles.note}>
                  Chart screenshots arrive with image storage in the next phase. For now this step has nothing to add,
                  and they can be added to the position later.
                </p>
              ) : null}

              {step === 3 ? (
                <div className={styles.form}>
                  {planOptional ? (
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={wantsStatic}
                        onChange={(event) => {
                          setWantsStatic(event.target.checked)
                        }}
                      />
                      Record a static plan — a stop and targets, so risk and R can be scored. No feed or alerts.
                    </label>
                  ) : null}
                  {live || wantsStatic ? (
                    <>
                      <PlanInputs
                        form={plan}
                        onChange={setPlan}
                        currency={currency}
                        defaultMethod={defaults?.trailingMethod ?? null}
                        live={live}
                      />
                      {/* Only a live plan stores one; a static plan is levels on the position. */}
                      {live ? (
                        <FormField label="Note">
                          <input
                            className={styles.input}
                            value={plan.note}
                            onChange={(event) => {
                              setPlan({ ...plan, note: event.target.value })
                            }}
                            placeholder="Thesis, catalyst, why this level"
                          />
                        </FormField>
                      ) : null}
                      {live && defaults ? (
                        <FrameworkNote
                          partialExitFraction={defaults.partialExitFraction}
                          timeStopDays={defaults.timeStopDays}
                          trailingAtrMultiple={defaults.trailingAtrMultiple}
                        />
                      ) : null}
                    </>
                  ) : null}
                  <FormField label={`Account size (${unit})`} hint="Locked on this position, for the risk %">
                    <input
                      className={styles.input}
                      inputMode="decimal"
                      value={accountEquity}
                      onChange={(event) => {
                        setEquity(event.target.value)
                      }}
                    />
                  </FormField>
                  {live || wantsStatic ? (
                    <PlanPreview
                      symbol={symbol}
                      entryDate={entry.date}
                      entryPrice={entry.price}
                      shares={entry.shares}
                      form={plan}
                      accountEquity={accountEquity.trim() === '' ? null : accountEquity.trim()}
                      currency={currency}
                    />
                  ) : null}
                </div>
              ) : null}

              {submit.problem ? (
                <p className={styles.formError} role="alert">
                  {submit.problem}
                </p>
              ) : null}

              <div className={styles.footer}>
                <Dialog.Close asChild>
                  <button type="button" className={cx(styles.secondary, styles.footerGap)}>
                    Cancel
                  </button>
                </Dialog.Close>
                {step > 0 ? (
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => {
                      setStep(step - 1)
                    }}
                  >
                    Back
                  </button>
                ) : null}
                {step < STEPS.length - 1 ? (
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={(step === 0 && !sourceReady) || (step === 1 && setupId === '')}
                    onClick={() => {
                      setStep(step + 1)
                    }}
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={submit.pending || (live && plan.supportLevel.trim() === '')}
                    onClick={() => {
                      submit.run(undefined)
                    }}
                  >
                    {submit.pending ? 'Opening…' : 'Open position'}
                  </button>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
