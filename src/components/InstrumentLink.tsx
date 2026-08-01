/**
 * An instrument's symbol and name, linked to its TradingView chart.
 *
 * One implementation for every screen that lists instruments, so the venue
 * mapping and the "funds have no chart" rule can't drift between them.
 *
 * Funds render as plain text rather than a dead link — see `tradingViewUrl`.
 */
import styles from './InstrumentLink.module.scss'
import { cx } from '~/lib/cx'
import type { AssetClass } from '~/lib/domain/types'
import { tradingViewUrl } from '~/lib/tradingview'

/** Marks the symbol as leaving the app, so the jump isn't a surprise. */
function ExternalIcon() {
  return (
    <svg
      className={styles.icon}
      width="9"
      height="9"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 2h8v8M14 2 6.5 9.5M11 10.5V14H2V5h3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

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
        <ExternalIcon />
      </span>
      <span className={styles.name}>{name}</span>
      <span className="visually-hidden">— open chart on TradingView in a new tab</span>
    </a>
  )
}
