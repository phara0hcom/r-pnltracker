import styles from './DerivationBand.module.scss'
import { cx } from '~/lib/cx'

export interface DerivationNode {
  id: string
  label: string
  value: string
  hint: string
  tone?: 'profit' | 'loss' | 'flat'
  /** A raw CSS size (`var(--text-lg)`/`var(--text-xl)`) — only two values ever occur. */
  size: string
  /** The operator glyph *after* this node; empty on the last one. */
  op: string
}

/** The PC "how the year gets to the estimated tax" flow — five nodes then a net-after-tax block. */
export function DerivationBand({
  nodes,
  netAfterTax,
}: {
  nodes: DerivationNode[]
  netAfterTax: { value: string; hint: string; tone: 'profit' | 'loss' | 'flat' }
}) {
  return (
    <div className={styles.chain}>
      {nodes.map((node) => (
        <span key={node.id} className={styles.node}>
          <span className={styles.nodeText}>
            <span className={styles.label}>{node.label}</span>
            <span
              className={cx(styles.value, node.tone === 'profit' && styles.profit, node.tone === 'loss' && styles.loss)}
              style={{ fontSize: node.size }}
            >
              {node.value}
            </span>
            <span className={styles.hint}>{node.hint}</span>
          </span>
          {node.op ? (
            <>
              <span className={styles.connector} />
              <span className={styles.op}>{node.op}</span>
            </>
          ) : null}
        </span>
      ))}
      <span className={styles.netBlock}>
        <span className={styles.label}>Net after tax</span>
        <span
          className={cx(styles.netValue, netAfterTax.tone === 'profit' && styles.profit, netAfterTax.tone === 'loss' && styles.loss)}
        >
          {netAfterTax.value}
        </span>
        <span className={styles.hint}>{netAfterTax.hint}</span>
      </span>
    </div>
  )
}
