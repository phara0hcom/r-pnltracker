/**
 * A setup's four figures for one kind. Every value arrives formatted or as a count
 * from the server; this only lays them out.
 */
import styles from './Setups.module.scss'
import { pct, rSigned, tone } from '~/components/format'
import { Stat } from '~/components/screen'
import { cx } from '~/lib/cx'
import type { JournalKind } from '~/lib/playbook/types'
import type { SetupFiguresView } from '~/server/playbook'

export const KIND_LABEL: Record<JournalKind, string> = { REAL: 'Real', PAPER: 'Paper' }

export function KindTag({ kind }: { kind: JournalKind }) {
  return <span className={cx(styles.kind, kind === 'PAPER' && styles.kindPaper)}>{KIND_LABEL[kind]}</span>
}

export function SetupFigures({ figures }: { figures: SetupFiguresView }) {
  return (
    <div className={styles.figures}>
      <Stat label="Closed" value={figures.closed} />
      <Stat label="Win rate" value={pct(figures.winRate, 0)} />
      <Stat
        label="Avg R"
        value={rSigned(figures.averageR)}
        tone={tone(figures.averageR)}
        hint={`${String(figures.withR)} with an R`}
      />
      <Stat
        label="Avg score"
        value={figures.averageScore ?? '—'}
        hint={figures.withScore < figures.closed ? `${String(figures.withScore)} scored` : undefined}
      />
    </div>
  )
}
