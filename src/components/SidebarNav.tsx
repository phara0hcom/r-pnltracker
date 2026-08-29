/**
 * The navigation itself: links, the signed-in user, and sign out.
 *
 * Split out of `AppShell` because it is rendered twice — in the desktop sidebar
 * and inside the mobile drawer. Ten links plus the `scope`-carrying active-link
 * logic duplicated across two branches would drift the first time one is
 * touched.
 */
import { Link } from '@tanstack/react-router'
import styles from './SidebarNav.module.scss'
import { useAccountFilter } from '~/components/ui/AccountSwitch'
import { signOut } from '~/lib/auth-client'
import { cx } from '~/lib/cx'
import type { SessionUser } from '~/lib/session'

interface NavItem {
  to: string
  label: string
  /** Short glyph rather than an icon dependency. */
  glyph: string
}

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', glyph: '◎' },
  { to: '/trades', label: 'Trades', glyph: '≡' },
  { to: '/positions', label: 'Positions', glyph: '▤' },
  { to: '/dividends', label: 'Dividends', glyph: '◇' },
  { to: '/calendar', label: 'Calendar', glyph: '▦' },
  { to: '/stats', label: 'Stats', glyph: '◈' },
  { to: '/nisa', label: 'NISA', glyph: '◱' },
  { to: '/tax', label: 'Tax', glyph: '¥' },
  { to: '/import', label: 'Import', glyph: '↥' },
  { to: '/settings', label: 'Settings', glyph: '⚙' },
]

export function SidebarNav({ user }: { user: SessionUser }) {
  const [account] = useAccountFilter()

  return (
    <>
      <ul className={styles.navList}>
        {NAV.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              /*
               * Carried on every link, including the screens that do not use
               * it. Those declare `scope` purely so it survives the trip —
               * dropping it on Trades meant a detour there silently reset the
               * switch, which is the whole reason it has its own key rather
               * than sharing Trades' `account`.
               */
              search={account !== 'ALL' ? { scope: account } : undefined}
              className={styles.navLink}
              activeProps={{ className: cx(styles.navLink, styles.navLinkActive) }}
            >
              <span className={styles.navGlyph} aria-hidden="true">
                {item.glyph}
              </span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className={styles.footer}>
        <div className={styles.user}>
          <span className={styles.userName}>{user.name}</span>
          <span className={styles.userEmail}>{user.email}</span>
        </div>
        <button
          type="button"
          className={styles.signOut}
          onClick={() => {
            void signOut().then(() => {
              window.location.href = '/signin'
            })
          }}
        >
          Sign out
        </button>
      </div>
    </>
  )
}
