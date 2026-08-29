/**
 * The navigation itself: links, the signed-in user, and sign out.
 *
 * Split out of `AppShell` because it is rendered twice — in the desktop sidebar
 * and inside the mobile drawer. Ten links plus the `scope`-carrying active-link
 * logic duplicated across two branches would drift the first time one is
 * touched.
 *
 * `collapsed` is the desktop icon rail. The drawer never passes it: it opens
 * over the whole screen, where there is no width to save.
 */
import * as Tooltip from '@radix-ui/react-tooltip'
import { Link } from '@tanstack/react-router'
import { NAV_ICONS, type NavRoute } from './icons/NavIcons'
import styles from './SidebarNav.module.scss'
import { useAccountFilter } from '~/components/ui/AccountSwitch'
import { signOut } from '~/lib/auth-client'
import { cx } from '~/lib/cx'
import type { SessionUser } from '~/lib/session'

/** Order down the sidebar. The icon comes from `NAV_ICONS`, keyed by the route. */
const NAV: { to: NavRoute; label: string }[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/trades', label: 'Trades' },
  { to: '/positions', label: 'Positions' },
  { to: '/dividends', label: 'Dividends' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/stats', label: 'Stats' },
  { to: '/nisa', label: 'NISA' },
  { to: '/tax', label: 'Tax' },
  { to: '/import', label: 'Import' },
  { to: '/settings', label: 'Settings' },
]

/**
 * Wraps a control in a tooltip only while the rail is collapsed.
 *
 * Expanded, the label is right there and a tooltip repeating it is noise.
 * Radix rather than `title` for the keyboard-focus and ARIA handling — an icon
 * rail is unusable if the only way to identify anything is to hover it.
 */
function RailLabel({
  label,
  collapsed,
  children,
}: {
  label: string
  collapsed: boolean
  children: React.ReactNode
}) {
  if (!collapsed) return children

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={styles.tooltip} side="right" sideOffset={8}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function SidebarNav({
  user,
  collapsed = false,
}: {
  user: SessionUser
  collapsed?: boolean
}) {
  const [account] = useAccountFilter()

  return (
    <>
      <ul className={styles.navList}>
        {NAV.map((item) => {
          const Icon = NAV_ICONS[item.to]
          return (
            <li key={item.to}>
              <RailLabel label={item.label} collapsed={collapsed}>
                <Link
                  to={item.to}
                  /*
                   * Carried on every link, including the screens that do not
                   * use it. Those declare `scope` purely so it survives the trip
                   * — dropping it on Trades meant a detour there silently reset
                   * the switch, which is the whole reason it has its own key
                   * rather than sharing Trades' `account`.
                   */
                  search={account !== 'ALL' ? { scope: account } : undefined}
                  className={cx(styles.navLink, collapsed && styles.navLinkRail)}
                  activeProps={{
                    className: cx(
                      styles.navLink,
                      collapsed && styles.navLinkRail,
                      styles.navLinkActive,
                    ),
                  }}
                >
                  <Icon className={styles.navIcon} />
                  {/* Hidden, never removed. The tooltip is a *description* —
                      Radix wires it up only while it is open — so dropping the
                      text leaves the link with no accessible name at all, and a
                      screen reader announces ten identical "link"s. */}
                  <span className={collapsed ? 'visually-hidden' : undefined}>{item.label}</span>
                </Link>
              </RailLabel>
            </li>
          )
        })}
      </ul>

      <div className={styles.footer}>
        {collapsed ? null : (
          <div className={styles.user}>
            <span className={styles.userName}>{user.name}</span>
            <span className={styles.userEmail}>{user.email}</span>
          </div>
        )}
        <RailLabel label={`Sign out — ${user.name}`} collapsed={collapsed}>
          <button
            type="button"
            className={cx(styles.signOut, collapsed && styles.signOutRail)}
            onClick={() => {
              void signOut().then(() => {
                window.location.href = '/signin'
              })
            }}
          >
            <svg
              className={styles.navIcon}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6" />
              <path d="M10.5 11 14 8l-3.5-3M14 8H6" />
            </svg>
            <span className={collapsed ? 'visually-hidden' : undefined}>Sign out</span>
          </button>
        </RailLabel>
      </div>
    </>
  )
}
