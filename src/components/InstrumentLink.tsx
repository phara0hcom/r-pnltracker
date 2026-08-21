/**
 * An instrument's symbol and name, linked to its TradingView chart.
 *
 * One implementation for every screen that lists instruments, so the venue
 * mapping and the "funds have no chart" rule can't drift between them.
 *
 * Funds render as plain text rather than a dead link — see `tradingViewUrl`.
 */
import styles from './InstrumentLink.module.scss'
import { ExternalIcon } from '~/components/icons/ExternalIcon'
import { cx } from '~/lib/cx'
import type { AssetClass } from '~/lib/domain/types'
import { tradingViewUrl } from '~/lib/tradingview'

export function InstrumentLink({
  symbol,
  name,
  assetClass,
  /** `compact` shrinks the symbol to match dense rows like the calendar dialog. */
  size = 'normal',
  className,
}: {
  symbol: string
  name: string
  assetClass: AssetClass
  size?: 'normal' | 'compact'
  className?: string
}) {
  const url = tradingViewUrl(symbol, assetClass)
  const cls = cx(styles.root, size === 'compact' && styles.compact, className)

  if (!url) {
    return (
      <div className={cls}>
        <span className={styles.symbol}>{symbol}</span>
        <span className={styles.name}>{name}</span>
      </div>
    )
  }

  return (
    <a
      className={cx(cls, styles.link)}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${symbol} on TradingView`}
    >
      <span className={styles.symbol}>
        {symbol}
        <ExternalIcon className={styles.icon} />
      </span>
      <span className={styles.name}>{name}</span>
      <span className="visually-hidden">— open chart on TradingView in a new tab</span>
    </a>
  )
}
