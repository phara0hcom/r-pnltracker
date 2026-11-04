/**
 * A setup's best and worst trades: each with its entry and exit charts and what the
 * owner noted at the time.
 *
 * One gallery per trade, so the lightbox walks that trade's images and no other's.
 * It is a layer on this page, and closing it comes back here. A link to the position
 * leaves the page; that page's back link stays fixed, and browser Back returns here.
 */
import { Link } from '@tanstack/react-router'
import { ImageGallery } from './ImageGallery'
import { ResultText, ScoreText } from './PositionTable'
import styles from './Setups.module.scss'
import { ACCOUNT_LABEL, rSigned, tone } from '~/components/format'
import { Empty } from '~/components/screen'
import { cx } from '~/lib/cx'
import { PHASE_LABEL } from '~/lib/playbook/images'
import type { RankedTrade as Trade, SetupRanking } from '~/server/playbook'

const toneClass = (value: string | null) => {
  const name = tone(value)
  return name === 'flat' ? undefined : styles[name]
}

function RankedTrade({ trade }: { trade: Trade }) {
  const { row, legs, images } = trade
  return (
    <li className={styles.trade}>
      <div className={styles.tradeHead}>
        <Link to="/playbook/$journalId" params={{ journalId: row.id }} className={styles.tradeLink}>
          {row.symbol} <span className={styles.tradeName}>{row.name}</span>
        </Link>
        <span className={styles.tradeFigures}>
          <span className={toneClass(row.r)}>{rSigned(row.r)}</span>
          <span>
            <ScoreText value={row.overall} provisional={row.provisional} />
          </span>
        </span>
      </div>
      <p className={styles.tradeMeta}>
        {row.kind === 'PAPER' ? 'Paper' : (ACCOUNT_LABEL[row.accountType ?? ''] ?? '')} · {row.openDate} →{' '}
        {row.closeDate ?? '—'} ·{' '}
        <span className={toneClass(row.result)}>
          <ResultText row={row} />
        </span>
      </p>
      {images.length > 0 ? (
        <ImageGallery images={images} compact />
      ) : (
        <p className={styles.tradeMeta}>No entry or exit charts.</p>
      )}
      {legs.length > 0 ? (
        <ul className={styles.notes}>
          {legs.map((leg) => (
            <li key={`${leg.side}-${leg.date}`} className={styles.note}>
              <span className={styles.noteLabel}>
                {PHASE_LABEL[leg.side]}
                {leg.rating === null ? '' : ` ${String(leg.rating)}`}
              </span>{' '}
              <span className={styles.noteDate}>{leg.date.slice(5).replace('-', '/')}</span>
              {leg.note ? <p className={styles.noteText}>{leg.note}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function TradeList({ title, ids, trades }: { title: string; ids: readonly string[]; trades: Record<string, Trade> }) {
  return (
    <div className={styles.list}>
      <h3 className={styles.listTitle}>{title}</h3>
      <ol className={styles.trades}>
        {ids.flatMap((id) => {
          const trade = trades[id]
          return trade ? [<RankedTrade key={id} trade={trade} />] : []
        })}
      </ol>
    </div>
  )
}

export function RankedTrades({
  ranking,
  byR,
  trades,
}: {
  ranking: SetupRanking
  byR: boolean
  trades: Record<string, Trade>
}) {
  const figure = byR ? 'R result' : 'overall score'
  const { list, unranked } = ranking
  const empty = 'single' in list && list.single.length === 0
  return (
    <>
      {empty ? (
        <Empty>
          {unranked > 0
            ? `None of its ${String(unranked)} closed positions has ${byR ? 'an R, as none has a stop' : 'a score yet'}.`
            : 'No closed positions yet.'}
        </Empty>
      ) : 'single' in list ? (
        <TradeList title={`Ranked by ${figure}`} ids={list.single} trades={trades} />
      ) : (
        <div className={cx(styles.lists, styles.listsSplit)}>
          <TradeList title="Best 5" ids={list.best} trades={trades} />
          <TradeList title="Worst 5" ids={list.worst} trades={trades} />
        </div>
      )}
      {!empty && unranked > 0 ? (
        <p className={styles.unranked}>
          {unranked} closed position{unranked === 1 ? ' has' : 's have'} no {byR ? 'R' : 'score'}, so {unranked === 1 ? 'is' : 'are'}{' '}
          not ranked here.
        </p>
      ) : null}
    </>
  )
}
