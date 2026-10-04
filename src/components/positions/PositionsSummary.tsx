/**
 * What sits above the Positions table: what the book is worth, how it splits,
 * and the holdings worth naming.
 *
 * Every figure arrives summed from `getPositions` — this lays them out and
 * does no arithmetic. The split by account is left out under 特定, where there
 * is one account to split.
 */
import { Link } from '@tanstack/react-router'
import styles from './PositionsSummary.module.scss'
import { ACCOUNT_LABEL, ACCOUNT_TITLE, ASSET_LABEL, pct, pctSigned, tone, yen, yenSigned } from '~/components/format'
import { WarnIcon } from '~/components/icons/WarnIcon'
import { cx } from '~/lib/cx'
import type { AccountFilter } from '~/lib/domain/types'
import type { Highlight } from '~/lib/pnl/positionSummary'
import type { PositionRow, PositionsData } from '~/server/screens'

const ACCOUNT_COLOR: Record<string, string> = {
  SPECIFIC: 'var(--color-specific)',
  NISA_GROWTH: 'var(--color-nisa-growth)',
  NISA_TSUMITATE: 'var(--color-nisa-tsumitate)',
  NISA_OLD: 'var(--color-nisa-old)',
}

const CLASS_COLOR: Record<string, string> = {
  JP_EQUITY: 'var(--color-class-jp)',
  US_EQUITY: 'var(--color-class-us)',
  FUND: 'var(--color-class-fund)',
}

const CLASS_TITLE: Record<string, string> = {
  JP_EQUITY: 'JP equity',
  US_EQUITY: 'US equity',
  FUND: 'Funds',
}

interface Part {
  key: string
  label: string
  color: string
  weight: number | null
  value: string
}

interface Split {
  title: string
  parts: Part[]
}

/** By account, then by asset class — or by class alone when one account is shown. */
function splitsOf(data: PositionsData, account: AccountFilter): Split[] {
  const byClass: Split = {
    title: 'By asset class',
    parts: data.classes.map((entry) => ({
      key: entry.assetClass,
      label: CLASS_TITLE[entry.assetClass] ?? entry.assetClass,
      color: CLASS_COLOR[entry.assetClass] ?? 'var(--color-text-subtle)',
      weight: entry.weight,
      value: entry.marketValueJpy,
    })),
  }
  if (account === 'SPECIFIC') return [byClass]
  const byAccount: Split = {
    title: 'By account',
    parts: data.accounts
      // An account holding only unpriced positions has no share to draw.
      .filter((entry) => entry.weight != null && entry.weight > 0)
      .map((entry) => ({
        key: entry.accountType,
        label: ACCOUNT_TITLE[entry.accountType] ?? entry.accountType,
        color: ACCOUNT_COLOR[entry.accountType] ?? 'var(--color-text-subtle)',
        weight: entry.weight,
        value: entry.marketValueJpy,
      })),
  }
  return [byAccount, byClass]
}

/**
 * A bar and its legend. The legend gives each part's share; its yen is on
 * hover, and in the table's account rows — beside the share it would crowd
 * the names out of a card this narrow.
 */
function Allocation({ split }: { split: Split }) {
  if (split.parts.length === 0) return null
  return (
    <div className={styles.allocation}>
      <span className={styles.label}>{split.title}</span>
      {/* The legend below carries every figure; the bar is its picture. */}
      <div className={styles.track} aria-hidden="true">
        {split.parts.map((part) => (
          <span
            key={part.key}
            className={styles.segment}
            style={{ flexGrow: part.weight ?? 0, backgroundColor: part.color }}
          />
        ))}
      </div>
      <ul className={styles.legend}>
        {split.parts.map((part) => (
          <li key={part.key} className={styles.legendItem} title={`${part.label}: ${yen(part.value)}`}>
            <span className={styles.swatch} style={{ backgroundColor: part.color }} aria-hidden="true" />
            <span className={styles.legendLabel}>{part.label}</span>
            <span className={styles.legendPct}>{pct(part.weight)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A fund's name is its symbol; anything else reads as both. */
const titleOf = (entry: { symbol: string; name: string }) =>
  entry.name === entry.symbol ? entry.name : `${entry.symbol} ${entry.name}`

function Highlights({ data, account }: { data: PositionsData; account: AccountFilter }) {
  const { largest, best, weakest } = data.highlights
  if (!largest) return null

  // Under 特定 every holding is in the one account, so the class says more.
  const where = (entry: Highlight) =>
    account === 'SPECIFIC'
      ? (ASSET_LABEL[entry.assetClass] ?? entry.assetClass)
      : (ACCOUNT_LABEL[entry.accountType] ?? entry.accountType)

  const lines: { label: string; entry: Highlight; figure: string; tint?: string }[] = [
    { label: 'Largest', entry: largest, figure: pct(largest.weight) },
  ]
  if (best) lines.push({ label: 'Best', entry: best, figure: pctSigned(best.unrealizedPct), tint: tone(best.unrealizedPct) })
  if (weakest) {
    lines.push({
      label: 'Weakest',
      entry: weakest,
      figure: pctSigned(weakest.unrealizedPct),
      tint: tone(weakest.unrealizedPct),
    })
  }

  return (
    <section className={cx(styles.card, styles.highlights)} aria-labelledby="positions-highlights">
      <h2 id="positions-highlights" className={styles.label}>
        Highlights
      </h2>
      <dl className={styles.highlightList}>
        {lines.map((line) => (
          <div key={line.label} className={styles.highlight}>
            <dt className={styles.highlightLabel}>{line.label}</dt>
            <dd className={styles.highlightWho}>
              <span className={styles.highlightTitle} title={titleOf(line.entry)}>
                {titleOf(line.entry)}
              </span>
              <span className={styles.highlightWhere}>{where(line.entry)}</span>
            </dd>
            <dd
              className={cx(
                styles.highlightFigure,
                line.tint === 'profit' && styles.profit,
                line.tint === 'loss' && styles.loss,
              )}
            >
              {line.figure}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Unrealized({ data }: { data: PositionsData }) {
  const { total } = data
  const tint = tone(total.unrealizedJpy)
  return (
    <span className={cx(styles.unrealized, tint === 'profit' && styles.profit, tint === 'loss' && styles.loss)}>
      {yenSigned(total.unrealizedJpy)} unrealized
      {total.unrealizedPct == null ? '' : ` · ${pctSigned(total.unrealizedPct)}`}
    </span>
  )
}

/**
 * PC: the value card, the allocation card and the highlights, in one row.
 * SP: the value card carries one allocation, with the highlights under it.
 */
export function PositionsSummary({
  data,
  account,
  compact,
}: {
  data: PositionsData
  account: AccountFilter
  compact: boolean
}) {
  const { total } = data
  const priced = total.count > total.unpriced
  const splits = priced ? splitsOf(data, account) : []

  if (compact) {
    const [first] = splits
    return (
      <div className={styles.stack}>
        <section className={cx(styles.card, styles.value)} aria-label="Market value">
          <span className={styles.label}>Market value</span>
          <span className={styles.figure}>{priced ? yen(total.marketValueJpy) : '—'}</span>
          {priced ? <Unrealized data={data} /> : null}
          <span className={styles.cost}>Cost basis {yen(total.costShownJpy)}</span>
          {first ? (
            <div className={styles.valueSplit}>
              <Allocation split={first} />
            </div>
          ) : null}
        </section>
        <Highlights data={data} account={account} />
      </div>
    )
  }

  return (
    <div className={cx(styles.row, splits.length === 0 && styles.rowNoSplit)}>
      <section className={cx(styles.card, styles.value)} aria-label="Market value">
        <span className={styles.label}>Market value</span>
        <span className={styles.figure}>{priced ? yen(total.marketValueJpy) : '—'}</span>
        {priced ? <Unrealized data={data} /> : null}
        <span className={styles.spacer} aria-hidden="true" />
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Cost basis</dt>
            <dd>{yen(total.costShownJpy)}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Open positions</dt>
            <dd>{total.count}</dd>
          </div>
        </dl>
      </section>
      {splits.length > 0 ? (
        <section className={cx(styles.card, styles.splits)} aria-label="Allocation">
          {splits.map((split) => (
            <Allocation key={split.title} split={split} />
          ))}
        </section>
      ) : null}
      <Highlights data={data} account={account} />
    </div>
  )
}

/**
 * Names what has no price, and what that leaves out.
 *
 * A holding with no price still has its cost counted, so the totals above
 * would otherwise read as a loss that is not there.
 */
export function UnpricedNotice({ rows, cost }: { rows: readonly PositionRow[]; cost: string }) {
  const missing = rows.filter((row) => row.marketValueJpy == null)
  if (missing.length === 0) return null
  const [only] = missing

  return (
    <div role="status" className={styles.notice}>
      <WarnIcon className={styles.noticeIcon} />
      <span className={styles.noticeText}>
        {missing.length === 1 && only
          ? `${titleOf(only)} has no price yet, so its ${yen(cost)} cost is left out of value, unrealized and weights.`
          : `${String(missing.length)} holdings have no price yet — ${missing
              .map((row) => (row.assetClass === 'FUND' ? row.name : row.symbol))
              .join(', ')} — so their ${yen(cost)} cost is left out of value, unrealized and weights.`}
      </span>
      <Link to="/settings" className={styles.noticeLink}>
        Set a price in Settings →
      </Link>
    </div>
  )
}
