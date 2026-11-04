/**
 * The setups, and how each performs. One card per active setup and per kind it is
 * used as, so real and paper are never added together. A setup with no positions
 * still has its card, which is where it gets edited or archived.
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { SetupDialog } from '~/components/playbook/SetupDialog'
import { KindTag, SetupFigures } from '~/components/playbook/SetupFigures'
import styles from '~/components/playbook/Setups.module.scss'
import { Empty, PageHeader } from '~/components/screen'
import { getSetups, type SetupCardView } from '~/server/playbook'

export const Route = createFileRoute('/_authed/playbook/setups/')({
  component: Setups,
  loader: () => getSetups(),
})

function Setups() {
  const initial = Route.useLoaderData()
  const { data } = useQuery({ queryKey: ['playbook', 'setups'], queryFn: () => getSetups(), initialData: initial })
  // `null` is a new setup; absent is no dialog.
  const [editing, setEditing] = useState<SetupCardView | null | undefined>(undefined)
  const close = () => {
    setEditing(undefined)
  }

  return (
    <>
      <Link to="/playbook" className={styles.back}>
        ← Playbook
      </Link>
      <PageHeader title="Setups" meta="Closed positions only. Past trades count as real." actionsBeside>
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            setEditing(null)
          }}
        >
          New setup
        </button>
      </PageHeader>

      {data.cards.length === 0 ? (
        <Empty>No setups yet. A setup is a type of play you file positions under.</Empty>
      ) : (
        <ul className={styles.cards}>
          {data.cards.map((card) => (
            <li key={`${card.id}-${card.kind ?? 'UNUSED'}`} className={styles.card}>
              <div className={styles.cardHead}>
                <Link
                  to="/playbook/setups/$setupId"
                  params={{ setupId: card.id }}
                  search={card.kind === 'PAPER' ? { kind: 'PAPER' } : {}}
                  className={styles.cardName}
                >
                  {card.name}
                </Link>
                {card.kind ? <KindTag kind={card.kind} /> : null}
              </div>
              {card.description ? <p className={styles.description}>{card.description}</p> : null}
              {card.kind ? <SetupFigures figures={card.figures} /> : <p className={styles.muted}>No positions yet.</p>}
              <div className={styles.cardEnd}>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    setEditing(card)
                  }}
                >
                  Edit<span className="visually-hidden"> {card.name}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing !== undefined ? <SetupDialog setup={editing} onClose={close} /> : null}
    </>
  )
}
