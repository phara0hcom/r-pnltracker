/**
 * Persistent application frame: sidebar navigation plus the routed content area.
 *
 * Rendered inside the `_authed` guard, so a user is always present here.
 */
import { Link } from '@tanstack/react-router'
import styles from './AppShell.module.scss'
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

export function AppShell({
  user,
  children,
}: {
  user: SessionUser
  children: React.ReactNode
}) {
  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label="Main navigation">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            ¥
          </span>
          <span className={styles.brandText}>PnL Tracker</span>
        </div>

        <ul className={styles.navList}>
          {NAV.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
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
      </nav>

      <main id="main" className={styles.content}>
        {children}
      </main>
    </div>
  )
}
