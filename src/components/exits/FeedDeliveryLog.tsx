/**
 * What the TradingView feed actually did, delivery by delivery.
 *
 * This screen's oldest blind spot: the endpoint answers a machine, and
 * TradingView reports a failure as a status code on a page nobody watches. So
 * three very different problems all presented identically — as plans quietly
 * reading "stale":
 *
 *   - the alert never fired, or was never pointed here → no row at all
 *   - it fired and was refused → a row with a 4xx and the reason
 *   - it fired, the bar was stored, and the answer came too late for
 *     TradingView to wait → a row with a 200 and a long duration
 *
 * Only the third is fixed by making the route faster, which is why the duration
 * is given as much room as the outcome. `durationMs` is server-side handling
 * time and stops before the log row is written; it cannot include the response
 * travelling back to TradingView, which no server can measure.
 */
import styles from './FeedDeliveryLog.module.scss'
import { Empty, Section, StatStrip, StripCell, Table } from '~/components/screen'
import { cx } from '~/lib/cx'
import type { FeedDeliveryTally, FeedDeliveryView } from '~/server/exit'

/**
 * Above this, a delivery is slow enough to be worth looking at.
 *
 * Not a timeout — TradingView does not publish one — but two full seconds on a
 * route whose work is two queries means something was queueing, and a burst of
 * these is the signature of every alert firing at the same close.
 */
const SLOW_MS = 2000

/** In the reader's own timezone, which is the only one that answers "when?". */
function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const duration = (ms: number): string => (ms < 1000 ? `${String(ms)} ms` : `${(ms / 1000).toFixed(2)} s`)

/** What happened, in the words the reader needs rather than the enum's. */
function verdict(row: FeedDeliveryView): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (row.outcome === 'UNKNOWN_TICKER') return { label: 'Unknown ticker', tone: 'bad' }
  if (row.outcome === 'INVALID_PAYLOAD') return { label: 'Payload refused', tone: 'bad' }
  // Stored, but the close did not become the current price. A fund has none to
  // publish and a replayed bar must not move it, so this is usually correct —
  // `detail` is set only when it failed rather than declined.
  if (row.detail !== null) return { label: 'Stored, price failed', tone: 'warn' }
  if (row.durationMs >= SLOW_MS) return { label: 'Stored, slow', tone: 'warn' }
  return { label: 'Stored', tone: 'ok' }
}

/** What else the delivery did, or why it was refused. */
function detail(row: FeedDeliveryView): string {
  if (row.detail !== null) return row.detail
  if (row.outcome === 'UNKNOWN_TICKER') {
    // Worth spelling out: the alert fired correctly and the endpoint answered
    // correctly. What is wrong is that this account has never traded the name,
    // so the fix is in TradingView or in the import, not here.
    return 'no instrument carries this ticker'
  }
  if (row.outcome !== 'STORED') return ''

  const priced = row.priced === true ? 'price published' : 'price unchanged'
  const filled =
    row.backfilled !== null && row.backfilled > 0
      ? ` · ${String(row.backfilled)} entry ATR filled`
      : ''
  return `${priced}${filled}`
}

export function FeedDeliveryLog({
  deliveries,
  tally,
}: {
  deliveries: FeedDeliveryView[]
  tally: FeedDeliveryTally
}) {
  return (
    <Section
      title="Feed deliveries"
      description="Every webhook call that got past the secret, newest first. A call with no row here never reached the app at all — check the alert itself. A row with a long duration did reach it and was stored, and the alert may still have given up waiting: TradingView reports that as a failed delivery even though the bar landed."
    >
      <StatStrip>
        <StripCell label="Last 24h" value={tally.total} hint="deliveries accepted" />
        <StripCell
          label="Bars stored"
          value={tally.stored}
          tone={tally.stored > 0 ? 'profit' : undefined}
          // Every cell carries a hint, including this one: a strip of cells
          // where only some have a third line sets their labels at different
          // heights, and the row stops reading as one thing.
          hint="reached exit_feed_bars"
        />
        <StripCell
          label="Refused"
          value={tally.failed}
          tone={tally.failed > 0 ? 'loss' : undefined}
          hint={tally.failed > 0 ? 'unknown ticker or bad payload' : 'none'}
        />
        <StripCell
          label="Slowest"
          value={tally.slowestMs === null ? '—' : duration(tally.slowestMs)}
          hint="server-side, excluding the reply"
        />
      </StatStrip>

      {deliveries.length === 0 ? (
        <Empty>
          No deliveries recorded yet. The log starts at the first alert that reaches the endpoint
          with the right secret — a wrong one is answered with a 404 and deliberately not recorded,
          so that a stranger posting at the URL cannot fill this table.
        </Empty>
      ) : (
        <Table caption="Recent TradingView webhook deliveries, newest first">
          <thead>
            <tr>
              <th scope="col">Received</th>
              <th scope="col">Ticker</th>
              <th scope="col">Bar</th>
              <th scope="col" className={styles.num}>
                Took
              </th>
              <th scope="col">Outcome</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((row) => {
              const result = verdict(row)
              return (
                <tr key={row.id}>
                  <td className={styles.stamp}>{when(row.receivedAt)}</td>
                  <td>
                    {row.ticker ?? '—'}
                    {row.name === null ? null : <span className={styles.name}>{row.name}</span>}
                  </td>
                  <td className={styles.stamp}>{row.tradingDay ?? '—'}</td>
                  <td className={cx(styles.num, row.durationMs >= SLOW_MS && styles.slow)}>
                    {duration(row.durationMs)}
                  </td>
                  <td>
                    <span className={cx(styles.badge, styles[result.tone])}>{result.label}</span>
                    <span className={styles.status}>{row.status}</span>
                  </td>
                  {/*
                    For a stored bar this says what else the delivery did; for a
                    refused one it says why. A pricing fault lands here too —
                    it used to reach the console alone, which is how the feed
                    could look healthy while no price ever updated.
                  */}
                  <td className={styles.detail}>{detail(row)}</td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </Section>
  )
}
