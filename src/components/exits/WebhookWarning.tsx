/**
 * Says plainly that no bars can arrive.
 *
 * The single most likely failure of this feature is a silent feed, so an unusable
 * secret is announced up front on the Playbook and on Settings rather than being
 * inferred from every plan reading stale.
 */
import styles from './WebhookWarning.module.scss'

export function WebhookWarning() {
  return (
    <p className={styles.warning}>
      <strong>Webhook not configured.</strong> Set <code>TRADINGVIEW_WEBHOOK_SECRET</code> to at least 24 characters —
      the endpoint refuses a shorter one — and point each TradingView alert at <code>/api/tv/&lt;secret&gt;</code>. Until
      then no bars can arrive and every live plan reads as stale. See <code>docs/exit-rules.md</code>.
    </p>
  )
}
