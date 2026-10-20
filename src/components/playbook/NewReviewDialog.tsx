/**
 * Starts a review: from trades already imported, or as a paper trade.
 *
 * A real review is picked as a pool — one symbol in one account — and then
 * the trades in it, because 移動平均法 averages within a pool and a review
 * that mixed two would be scored against a result neither produced. Only
 * trades in no other review are offered.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { formatPrice } from './formatPrice'
import styles from './PlaybookDialogs.module.scss'
import { toFieldErrors } from '~/components/exits/fieldErrors'
import { ACCOUNT_LABEL, qty } from '~/components/format'
import { FormField } from '~/components/trades/FormField'
import { useDialogHistory } from '~/components/ui/useDialogHistory'
import { cx } from '~/lib/cx'
import { reportError } from '~/lib/observability/report'
import { createReviewFn, type CandidatePool, type PlaybookView } from '~/server/playbook'

const poolKey = (pool: Pick<CandidatePool, 'symbol' | 'accountType'>) =>
  `${pool.symbol}\u0000${pool.accountType}`

export function NewReviewDialog({
  open,
  onOpenChange,
  playbooks,
  pools,
  defaultPlaybookId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  playbooks: PlaybookView[]
  pools: CandidatePool[]
  defaultPlaybookId: string | null
  onCreated: (id: string) => void
}) {
  useDialogHistory(open, () => {
    onOpenChange(false)
  })
  const [kind, setKind] = useState<'REAL' | 'PAPER'>('REAL')
  const [playbookId, setPlaybookId] = useState<string>('')
  const [pool, setPool] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [symbol, setSymbol] = useState('')
  const [name, setName] = useState('')
  const [assetClass, setAssetClass] = useState<'JP_EQUITY' | 'US_EQUITY'>('JP_EQUITY')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setKind(pools.length > 0 ? 'REAL' : 'PAPER')
      setPlaybookId(defaultPlaybookId ?? '')
      setPool('')
      setPicked(new Set())
      setSymbol('')
      setName('')
      setErrors({})
    }
  }

  const chosen = pools.find((candidate) => poolKey(candidate) === pool) ?? null

  const create = useMutation({
    mutationFn: () => {
      const playbook = playbookId === '' ? null : playbookId
      return kind === 'REAL'
        ? createReviewFn({ data: { kind, playbookId: playbook, tradeIds: [...picked] } })
        : createReviewFn({ data: { kind, playbookId: playbook, symbol, name, assetClass } })
    },
    onSuccess: (result) => {
      onOpenChange(false)
      onCreated(result.id)
    },
    onError: (error: unknown) => {
      reportError(error, { mutation: 'createReview' })
      setErrors(toFieldErrors(error))
    },
  })

  const toggle = (id: string) => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  const live = playbooks.filter((playbook) => !playbook.archived)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>New review</Dialog.Title>
          <Dialog.Description className={styles.description}>
            Review trades you made, or log a paper trade — a setup you watched but did not take.
            Paper trades never reach any figure outside the playbook.
          </Dialog.Description>

          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault()
              setErrors({})
              create.mutate()
            }}
          >
            <div className={styles.kinds} role="group" aria-label="Kind of review">
              {(['REAL', 'PAPER'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={cx(styles.kind, kind === option && styles.kindActive)}
                  aria-pressed={kind === option}
                  onClick={() => {
                    setKind(option)
                  }}
                >
                  {option === 'REAL' ? 'From my trades' : 'Paper trade'}
                </button>
              ))}
            </div>

            <FormField label="Playbook" error={errors.playbookId}>
              <select
                className={styles.input}
                value={playbookId}
                onChange={(event) => {
                  setPlaybookId(event.target.value)
                }}
              >
                <option value="">No playbook yet</option>
                {live.map((playbook) => (
                  <option key={playbook.id} value={playbook.id}>
                    {playbook.name}
                  </option>
                ))}
              </select>
            </FormField>

            {kind === 'REAL' ? (
              pools.length === 0 ? (
                <p className={styles.empty}>Every imported equity trade is already in a review.</p>
              ) : (
                <>
                  <FormField label="Position" error={errors.tradeIds}>
                    <select
                      className={styles.input}
                      value={pool}
                      onChange={(event) => {
                        setPool(event.target.value)
                        setPicked(new Set())
                      }}
                      required
                    >
                      <option value="">Choose a symbol…</option>
                      {pools.map((candidate) => (
                        <option key={poolKey(candidate)} value={poolKey(candidate)}>
                          {candidate.symbol} · {candidate.name} ·{' '}
                          {ACCOUNT_LABEL[candidate.accountType] ?? candidate.accountType}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  {chosen ? (
                    <fieldset className={styles.trades}>
                      <legend className="visually-hidden">Trades to review</legend>
                      {chosen.trades.map((trade) => (
                        <label key={trade.id} className={styles.tradeOption}>
                          <input
                            type="checkbox"
                            checked={picked.has(trade.id)}
                            onChange={() => {
                              toggle(trade.id)
                            }}
                          />
                          <span className={styles.side}>
                            {trade.kind === 'ENTRY' ? 'Buy' : 'Sell'}
                          </span>
                          <span>{trade.date}</span>
                          <span>
                            {qty(trade.quantity)} @ {formatPrice(trade.price, chosen.currency)}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                </>
              )
            ) : (
              <div className={styles.row}>
                <FormField label="Symbol" error={errors.symbol} hint="7203, AAPL">
                  <input
                    className={styles.input}
                    value={symbol}
                    onChange={(event) => {
                      setSymbol(event.target.value)
                    }}
                    required
                  />
                </FormField>
                <FormField label="Name" error={errors.name}>
                  <input
                    className={styles.input}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value)
                    }}
                  />
                </FormField>
                <FormField label="Market" error={errors.assetClass}>
                  <select
                    className={styles.input}
                    value={assetClass}
                    onChange={(event) => {
                      setAssetClass(event.target.value as 'JP_EQUITY' | 'US_EQUITY')
                    }}
                  >
                    <option value="JP_EQUITY">Japan (¥)</option>
                    <option value="US_EQUITY">US ($)</option>
                  </select>
                </FormField>
              </div>
            )}

            {errors.form ? (
              <p className={styles.formError} role="alert">
                {errors.form}
              </p>
            ) : null}

            <div className={styles.footer}>
              <Dialog.Close asChild>
                <button type="button" className={styles.secondary}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                className={cx(styles.primary, create.isPending && styles.busy)}
                disabled={create.isPending || (kind === 'REAL' && picked.size === 0)}
              >
                {create.isPending ? 'Creating…' : 'Create review'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
