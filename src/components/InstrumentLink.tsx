/**
 * An instrument's symbol and name, linked to its TradingView chart.
 *
 * One implementation for every screen that lists instruments, so the venue
 * mapping and the "funds have no chart" rule can't drift between them.
 *
 * Funds render as plain text rather than a dead link — see `tradingViewUrl`.
 *
 * Names are long and the column is narrow, so the name truncates. On touch,
 * press and hold it to read the whole thing: a tap has to stay reserved for the
 * chart, and there is no hover to fall back on. Pointer users get the same
 * string from the `title`.
 */
import styles from './InstrumentLink.module.scss'
import { ExternalIcon } from '~/components/icons/ExternalIcon'
import { RevealableText } from '~/components/ui/RevealableText'
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

  /*
   * Funds carry no ticker in any Rakuten export, so their symbol *is* their
   * name — a 45-character string on the line meant for `8411`. Rendering the
   * name again below would stack the same truncated text twice, so the first
   * line takes over as the name and the reveal goes with it.
   */
  const selfNamed = name === symbol

  if (!url) {
    return (
      <div className={cls}>
        <span className={styles.symbol}>
          {selfNamed ? (
            <RevealableText text={symbol} className={styles.symbolText} />
          ) : (
            <span className={styles.symbolText}>{symbol}</span>
          )}
        </span>
        {selfNamed ? null : <RevealableText text={name} className={styles.name} />}
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
        {/* Its own element so it can ellipsize: text sitting directly in a flex
            container is an anonymous item and cannot be truncated. */}
        {selfNamed ? (
          <RevealableText text={symbol} className={styles.symbolText} />
        ) : (
          <span className={styles.symbolText}>{symbol}</span>
        )}
        <ExternalIcon className={styles.icon} />
      </span>
      {selfNamed ? null : <RevealableText text={name} className={styles.name} />}
      <span className="visually-hidden">— open chart on TradingView in a new tab</span>
    </a>
  )
}
