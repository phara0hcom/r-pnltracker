/**
 * This year's taxable result, in the place the NISA card takes on the other
 * filters — 特定 has no quota to plan around, but it does have a tax bill.
 *
 * The Tax screen's figures for the current year, 受渡日 basis: closes settling
 * this year, losses netted against gains, 20.315% of a positive net. It is an
 * estimate because capital-gains withholding appears in no export.
 */
import { Link } from '@tanstack/react-router'
import styles from './TaxYearCard.module.scss'
import { yen } from '~/components/format'
import type { DashboardTaxYear } from '~/server/portfolio'

export function TaxYearCard({ tax }: { tax: DashboardTaxYear }) {
  const losses = Number(tax.taxableLossesJpy)

  return (
    <section className={styles.card} aria-labelledby="tax-year-title">
      <div className={styles.head}>
        <h2 id="tax-year-title" className={styles.title}>
          Tax this year · 特定口座 · {tax.year}
        </h2>
        <span className={styles.basis}>受渡日 basis · estimate at 20.315%</span>
      </div>

      <dl className={styles.figures}>
        <div className={styles.figure}>
          <dt>Taxable gains</dt>
          <dd>{yen(tax.taxableGainsJpy)}</dd>
        </div>
        <div className={styles.figure}>
          <dt>Losses offset</dt>
          {/* Arrives as a magnitude; it is taken off, so it reads as a minus. */}
          <dd className={losses > 0 ? styles.loss : undefined}>{yen(-losses)}</dd>
        </div>
        <div className={styles.figure}>
          <dt>Net taxable</dt>
          <dd>{yen(tax.netTaxableJpy)}</dd>
        </div>
        <div className={styles.figure}>
          <dt>Estimated tax</dt>
          <dd className={styles.tax}>{yen(tax.estimatedTaxJpy)}</dd>
        </div>
      </dl>

      <div className={styles.foot}>
        <span>
          {tax.closes} close{tax.closes === 1 ? '' : 's'} settling in {tax.year}. No export carries
          the withholding, so this is worked out from your closes.
        </span>
        <Link to="/tax" search={{ basis: 'CALENDAR', scope: 'SPECIFIC' }} className={styles.link}>
          Open Tax →
        </Link>
      </div>
    </section>
  )
}
