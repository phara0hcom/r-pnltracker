/**
 * The position page's three forms: Edit plan, Edit position, and linking the
 * imported trades. Each is opened from the page and refreshes it on success.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import styles from './Dialog.module.scss'
import { PlanInputs, PlanPreview, target1OverrideOf, type PlanForm } from './PlanFields'
import { usePlaybookAction } from './usePlaybookAction'
import { priceText, qty } from '~/components/format'
import { ExecutionTimeInput } from '~/components/trades/ExecutionTimeInput'
import { FormField } from '~/components/trades/FormField'
import { useDialogHistory } from '~/components/ui/useDialogHistory'
import { cx } from '~/lib/cx'
import { EMPTY_TIME, resolveExecutedAt, timedMarket, toTimeInput, type TimeInput } from '~/lib/import/executionTime'
import type { LegSide } from '~/lib/playbook/types'
import { getPosition, linkPosition, updatePlan, updatePosition, type PositionDetail } from '~/server/playbook'

export function Frame({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  children: React.ReactNode
}) {
  useDialogHistory(open, onClose)
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>{title}</Dialog.Title>
          <Dialog.Description className={styles.description}>{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Footer({
  problem,
  pending,
  label,
  disabled = false,
  onClose,
  onSubmit,
}: {
  problem: string | null
  pending: boolean
  label: string
  disabled?: boolean
  onClose: () => void
  onSubmit: () => void
}) {
  return (
    <>
      {problem ? (
        <p className={styles.formError} role="alert">
          {problem}
        </p>
      ) : null}
      <div className={styles.footer}>
        <button type="button" className={styles.secondary} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={styles.primary} disabled={pending || disabled} onClick={onSubmit}>
          {pending ? 'Saving…' : label}
        </button>
      </div>
    </>
  )
}

/** Mounted only while open, so it starts from the position as it now reads. */
function EditLivePlan({ position, onClose }: { position: PositionDetail; onClose: () => void }) {
  const view = position.planView
  const row = view.kind === 'LIVE' ? view.row : null
  const exact = view.kind === 'LIVE' ? view.exact : null
  const [entryPrice, setEntryPrice] = useState(exact?.entryPrice ?? '')
  const [shares, setShares] = useState(row?.totalShares ?? '')
  const [form, setForm] = useState<PlanForm>({
    supportLevel: exact?.supportLevel ?? '',
    stopMultiple: view.kind === 'LIVE' ? view.stopMultiple : '',
    targetMultiple: view.kind === 'LIVE' ? view.targetMultiple : '',
    targetManual: view.kind === 'LIVE' && view.target1Manual,
    target1: exact?.target1Override ?? '',
    extraTargets: position.extraTargets,
    trailingMethod: row?.trailingMethodOverride ?? '',
    note: row?.note ?? '',
  })
  const save = usePlaybookAction(
    () =>
      updatePlan({
        data: {
          id: position.id,
          live: {
            entryPrice: entryPrice.trim(),
            totalShares: shares.trim(),
            supportLevel: form.supportLevel.trim(),
            stopMultiple: form.stopMultiple.trim(),
            targetMultiple: form.targetMultiple.trim(),
            target1Override: target1OverrideOf(form),
            trailingMethod: form.trailingMethod === '' ? null : form.trailingMethod,
            note: form.note.trim() === '' ? null : form.note.trim(),
          },
          extraTargets: form.extraTargets,
        },
      }),
    onClose,
  )
  const unit = position.currency === 'USD' ? '$' : '¥'
  return (
    <div className={styles.form}>
      <div className={styles.row}>
        <FormField label={`Entry price (${unit})`} hint="Blended over the streak">
          <input
            className={styles.input}
            inputMode="decimal"
            value={entryPrice}
            onChange={(event) => {
              setEntryPrice(event.target.value)
            }}
          />
        </FormField>
        <FormField label="Total shares" hint="Size at entry">
          <input
            className={styles.input}
            inputMode="decimal"
            value={shares}
            onChange={(event) => {
              setShares(event.target.value)
            }}
          />
        </FormField>
      </div>
      <PlanInputs form={form} onChange={setForm} currency={position.currency} defaultMethod={null} live />
      <FormField label="Note">
        <input
          className={styles.input}
          value={form.note}
          onChange={(event) => {
            setForm({ ...form, note: event.target.value })
          }}
          placeholder="Thesis, catalyst, why this level"
        />
      </FormField>
      <PlanPreview
        symbol={position.symbol}
        entryDate={row?.entryDate ?? position.openDate}
        entryPrice={entryPrice}
        shares={shares}
        form={form}
        accountEquity={position.accountEquity}
        currency={position.currency}
      />
      <Footer
        problem={save.problem}
        pending={save.pending}
        label="Save plan"
        onClose={onClose}
        onSubmit={() => {
          save.run(undefined)
        }}
      />
    </div>
  )
}

function EditStaticPlan({ position, onClose }: { position: PositionDetail; onClose: () => void }) {
  const [stop, setStop] = useState(position.exactStop ?? '')
  const [target1, setTarget1] = useState(position.exactTarget1 ?? '')
  const [targets, setTargets] = useState(position.extraTargets)
  const unit = position.currency === 'USD' ? '$' : '¥'
  const save = usePlaybookAction(
    () =>
      updatePlan({
        data: {
          id: position.id,
          static: {
            stopPrice: stop.trim() === '' ? null : stop.trim(),
            target1Price: target1.trim() === '' ? null : target1.trim(),
          },
          extraTargets: targets,
        },
      }),
    onClose,
  )
  return (
    <div className={styles.form}>
      <div className={styles.row}>
        <FormField label={`Stop (${unit})`}>
          <input
            className={styles.input}
            inputMode="decimal"
            value={stop}
            onChange={(event) => {
              setStop(event.target.value)
            }}
          />
        </FormField>
        <FormField label={`Target 1 (${unit})`}>
          <input
            className={styles.input}
            inputMode="decimal"
            value={target1}
            onChange={(event) => {
              setTarget1(event.target.value)
            }}
          />
        </FormField>
      </div>
      {targets.map((target, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <div className={styles.targetRow} key={index}>
          <FormField label={`Extra target ${String(index + 1)} (${unit})`}>
            <input
              className={styles.input}
              inputMode="decimal"
              value={target.price}
              onChange={(event) => {
                setTargets(targets.map((item, at) => (at === index ? { ...item, price: event.target.value } : item)))
              }}
            />
          </FormField>
          <FormField label="Fraction to sell">
            <input
              className={styles.input}
              inputMode="decimal"
              value={target.fraction}
              onChange={(event) => {
                setTargets(targets.map((item, at) => (at === index ? { ...item, fraction: event.target.value } : item)))
              }}
            />
          </FormField>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              setTargets(targets.filter((_, at) => at !== index))
            }}
          >
            Remove<span className="visually-hidden"> extra target {index + 1}</span>
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          className={cx(styles.secondary, styles.small)}
          onClick={() => {
            setTargets([...targets, { price: '', fraction: '' }])
          }}
        >
          Add a target
        </button>
      </div>
      <Footer
        problem={save.problem}
        pending={save.pending}
        label="Save plan"
        onClose={onClose}
        onSubmit={() => {
          save.run(undefined)
        }}
      />
    </div>
  )
}

export function EditPlanDialog({ position, onClose }: { position: PositionDetail; onClose: () => void }) {
  const live = position.planView.kind === 'LIVE'
  return (
    <Frame
      open
      onClose={onClose}
      title={`Edit plan — ${position.symbol}`}
      description={
        live
          ? 'Corrects the locked entry facts — the record, not the market. The feed never moves them.'
          : 'A static plan: the stop and targets this trade is scored against.'
      }
    >
      {live ? <EditLivePlan position={position} onClose={onClose} /> : <EditStaticPlan position={position} onClose={onClose} />}
    </Frame>
  )
}

interface LegDraft {
  key: string
  id?: string
  side: LegSide
  date: string
  time: TimeInput
  price: string
  quantity: string
  fee: string
}

/** Setup, and the typed legs of a position that has no trades to read them from. */
export function EditPositionDialog({ position, onClose }: { position: PositionDetail; onClose: () => void }) {
  const [setupId, setSetupId] = useState(position.setupId ?? '')
  const [legs, setLegs] = useState<LegDraft[]>(
    () =>
      position.typedLegs?.map((leg) => ({
        key: leg.id,
        id: leg.id,
        side: leg.side,
        date: leg.date,
        time: toTimeInput(leg.date, leg.executedAt ? new Date(leg.executedAt) : null),
        price: leg.price,
        quantity: leg.quantity,
        fee: leg.fee,
      })) ?? [],
  )
  const market = timedMarket(position.assetClass)
  const editable = position.typedLegs !== null
  const setLeg = (key: string, patch: Partial<LegDraft>) => {
    setLegs(legs.map((leg) => (leg.key === key ? { ...leg, ...patch } : leg)))
  }
  const save = usePlaybookAction(
    () =>
      updatePosition({
        data: {
          id: position.id,
          setupId: setupId === '' ? null : setupId,
          ...(editable && {
            legs: legs.map((leg) => ({
              id: leg.id,
              side: leg.side,
              date: leg.date,
              executedAt: resolveExecutedAt(leg.date, leg.time)?.toISOString() ?? null,
              price: leg.price.trim(),
              quantity: leg.quantity.trim(),
              fee: leg.fee.trim() || '0',
            })),
          }),
        },
      }),
    onClose,
  )
  return (
    <Frame
      open
      onClose={onClose}
      title={`Edit position — ${position.symbol}`}
      description={
        editable
          ? 'These legs are typed in, as no trades back them yet.'
          : 'Symbol, account and each leg’s figures come from the trades. A leg’s time is set on the leg.'
      }
    >
      <div className={styles.form}>
        <FormField label="Setup">
          <select
            className={styles.input}
            value={setupId}
            onChange={(event) => {
              setSetupId(event.target.value)
            }}
          >
            <option value="">No setup</option>
            {position.setups.map((setup) => (
              <option key={setup.id} value={setup.id}>
                {setup.name}
              </option>
            ))}
          </select>
        </FormField>
        {editable
          ? legs.map((leg, index) => (
              <div key={leg.key} className={styles.fixed}>
                <div className={styles.legRow}>
                  <FormField label="Side">
                    <select
                      className={styles.input}
                      value={leg.side}
                      onChange={(event) => {
                        setLeg(leg.key, { side: event.target.value as LegSide })
                      }}
                    >
                      <option value="ENTRY">Buy</option>
                      <option value="EXIT">Sell</option>
                    </select>
                  </FormField>
                  <FormField label="Date">
                    <input
                      className={styles.input}
                      type="date"
                      value={leg.date}
                      onChange={(event) => {
                        setLeg(leg.key, { date: event.target.value })
                      }}
                    />
                  </FormField>
                  <FormField label="Price">
                    <input
                      className={styles.input}
                      inputMode="decimal"
                      value={leg.price}
                      onChange={(event) => {
                        setLeg(leg.key, { price: event.target.value })
                      }}
                    />
                  </FormField>
                  <FormField label="Shares">
                    <input
                      className={styles.input}
                      inputMode="decimal"
                      value={leg.quantity}
                      onChange={(event) => {
                        setLeg(leg.key, { quantity: event.target.value })
                      }}
                    />
                  </FormField>
                  <FormField label="Fee">
                    <input
                      className={styles.input}
                      inputMode="decimal"
                      value={leg.fee}
                      onChange={(event) => {
                        setLeg(leg.key, { fee: event.target.value })
                      }}
                    />
                  </FormField>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => {
                      setLegs(legs.filter((other) => other.key !== leg.key))
                    }}
                  >
                    Remove<span className="visually-hidden"> leg {index + 1}</span>
                  </button>
                </div>
                {market ? (
                  <ExecutionTimeInput
                    tradeDate={leg.date}
                    market={market}
                    value={leg.time}
                    label={`leg ${String(index + 1)}`}
                    onChange={(time) => {
                      setLeg(leg.key, { time })
                    }}
                  />
                ) : null}
              </div>
            ))
          : null}
        {editable ? (
          <div>
            <button
              type="button"
              className={cx(styles.secondary, styles.small)}
              onClick={() => {
                setLegs([
                  ...legs,
                  {
                    key: `new-${String(legs.length)}-${String(Date.now())}`,
                    side: 'EXIT',
                    date: legs.at(-1)?.date ?? position.openDate,
                    time: EMPTY_TIME,
                    price: '',
                    quantity: '',
                    fee: '0',
                  },
                ])
              }}
            >
              Add a leg
            </button>
          </div>
        ) : null}
        <Footer
          problem={save.problem}
          pending={save.pending}
          label="Save"
          onClose={onClose}
          onSubmit={() => {
            save.run(undefined)
          }}
        />
      </div>
    </Frame>
  )
}

/**
 * Pick a streak, not trades: membership is derived from the streak, so individual
 * fills are never ticked. Rakuten's figures may differ from what was typed, and
 * correcting the plan to them is offered rather than assumed.
 */
export function LinkDialog({ position, onClose }: { position: PositionDetail; onClose: () => void }) {
  const [chosen, setChosen] = useState(position.candidates.length === 1 ? (position.candidates[0]?.anchorId ?? '') : '')
  const [correct, setCorrect] = useState(true)
  const candidate = position.candidates.find((item) => item.anchorId === chosen)
  const link = usePlaybookAction(
    () =>
      linkPosition({
        data: { id: position.id, anchorTradeId: chosen, correctPlan: correct && candidate?.planDiffers === true },
      }),
    onClose,
  )
  return (
    <Frame
      open
      onClose={onClose}
      title={`Link trades — ${position.symbol}`}
      description="Choose the holding streak this position is. Its top-ups, partial exits and close then join by themselves as they are imported."
    >
      <div className={styles.form}>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Matching streaks</legend>
          <div className={styles.choices}>
            {position.candidates.map((item) => (
              <label key={item.anchorId} className={styles.choice}>
                <input
                  type="radio"
                  name="candidate"
                  checked={chosen === item.anchorId}
                  onChange={() => {
                    setChosen(item.anchorId)
                  }}
                />
                <span className={styles.choiceMain}>
                  {item.entryDate}
                  {item.closeDate ? ` → ${item.closeDate}` : ' → held'} · {qty(item.shares)} at{' '}
                  {priceText(item.entryPrice, position.currency)}
                  {item.fills.map((fill) => (
                    <span key={fill.id} className={styles.choiceMeta}>
                      {fill.date} {fill.side === 'ENTRY' ? 'Buy' : 'Sell'} {qty(fill.quantity)} at{' '}
                      {priceText(fill.price, position.currency)}
                    </span>
                  ))}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {candidate?.planDiffers ? (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={correct}
              onChange={(event) => {
                setCorrect(event.target.checked)
              }}
            />
            Also correct the plan to the imported entry: {qty(candidate.shares)} at{' '}
            {priceText(candidate.entryPrice, position.currency)}
            {candidate.planDateTo ? `, entered ${candidate.planDateTo}` : ''}
          </label>
        ) : null}
        <Footer
          problem={link.problem}
          pending={link.pending}
          label="Link"
          disabled={chosen === ''}
          onClose={onClose}
          onSubmit={() => {
            link.run(undefined)
          }}
        />
      </div>
    </Frame>
  )
}

/** `LinkDialog` from a list, which holds rows: loads the full position only when it opens. */
export function LinkLoader({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['playbook', 'position', id],
    queryFn: () => getPosition({ data: { id } }),
  })
  return data ? <LinkDialog position={data} onClose={onClose} /> : null
}
