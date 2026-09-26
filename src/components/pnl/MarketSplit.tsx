/**
 * Realized results split as Rakuten's app splits them: the JPY account in yen,
 * the USD account in dollars with its yen — the currency move included — in
 * brackets beside it. Display only; every figure arrives computed.
 */
import styles from './MarketSplit.module.scss'
import { money, moneySigned, tone, yen, yenSigned } from '~/components/format'
import { cx } from '~/lib/cx'
import type { MarketSplitView } from '~/lib/pnl/markets'

const toneClass = (value: string | null) =>
  tone(value) === 'profit' ? styles.profit : tone(value) === 'loss' ? styles.loss : undefined

/** The US side: dollars first, as Rakuten leads with them, yen in brackets. */
function UsdFigure({ split, signed }: { split: MarketSplitView; signed: boolean }) {
  if (split.usdRealizedUsd == null) return <span className={styles.none}>—</span>
  return (
    <>
      <span className={toneClass(split.usdRealizedUsd)}>
        {signed ? moneySigned(split.usdRealizedUsd, 'USD') : money(split.usdRealizedUsd, 'USD')}
      </span>
      <span className={styles.bracket}>
        ({signed ? yenSigned(split.usdRealizedJpy) : yen(split.usdRealizedJpy)})
      </span>
    </>
  )
}

function JpyFigure({ split, signed }: { split: MarketSplitView; signed: boolean }) {
  if (split.jpyRealizedJpy == null) return <span className={styles.none}>—</span>
  return (
    <span className={toneClass(split.jpyRealizedJpy)}>
      {signed ? yenSigned(split.jpyRealizedJpy) : yen(split.jpyRealizedJpy)}
    </span>
  )
}

/**
 * One labelled row per account, for a hero figure's breakdown.
 *
 * `currencyEffectJpy`, when given, says how much of the USD account's yen the
 * exchange rate accounts for — the reason its yen and dollars can disagree.
 */
export function MarketBreakdown({
  split,
  currencyEffectJpy,
}: {
  split: MarketSplitView
  currencyEffectJpy?: string | null
}) {
  return (
    <dl className={styles.breakdown}>
      <div className={styles.row}>
        <dt className={styles.label}>JPY account</dt>
        <dd className={styles.figure}>
          <JpyFigure split={split} signed />
        </dd>
      </div>
      <div className={styles.row}>
        <dt className={styles.label}>USD account</dt>
        <dd className={styles.figure}>
          <UsdFigure split={split} signed />
        </dd>
      </div>
      {currencyEffectJpy != null && split.usdRealizedUsd != null ? (
        <p className={styles.note}>
          The USD account&apos;s yen includes {yenSigned(currencyEffectJpy)} from the exchange rate
          moving between buy and sell.
        </p>
      ) : null}
    </dl>
  )
}

/** Both accounts on one line, for a card or a day. Omits a side with no closes. */
export function MarketInline({ split, className }: { split: MarketSplitView; className?: string }) {
  const hasJpy = split.jpyRealizedJpy != null
  const hasUsd = split.usdRealizedUsd != null
  if (!hasJpy && !hasUsd) return null
  return (
    <span className={cx(styles.inline, className)}>
      {hasJpy ? (
        <span>
          <span className={styles.label}>JPY</span> <JpyFigure split={split} signed />
        </span>
      ) : null}
      {hasJpy && hasUsd ? <span className={styles.separator}>·</span> : null}
      {hasUsd ? (
        <span>
          <span className={styles.label}>USD</span> <UsdFigure split={split} signed />
        </span>
      ) : null}
    </span>
  )
}
