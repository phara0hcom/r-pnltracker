/**
 * Persistent application frame: navigation plus the routed content area.
 *
 * Two presentations of one nav. Above 1024px it is a sticky sidebar. At or
 * below, where the sidebar used to collapse into a wrapped row of ten links
 * sitting on top of every screen, it becomes a header bar and a drawer.
 *
 * Rendered inside the `_authed` guard, so a user is always present here.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useState, useSyncExternalStore } from 'react'
import styles from './AppShell.module.scss'
import { SidebarNav } from './SidebarNav'
import {
  getPageTitle,
  getServerPageTitle,
  subscribePageTitle,
} from '~/components/screen/pageTitle'
import { RouteProgress, useRouteLoading } from '~/components/ui/RouteProgress'
import { cx } from '~/lib/cx'
import type { SessionUser } from '~/lib/session'

function Brand() {
  return (
    <div className={styles.brand}>
      <span className={styles.brandMark} aria-hidden="true">
        ¥
      </span>
      <span className={styles.brandText}>PnL Tracker</span>
    </div>
  )
}

export function AppShell({
  user,
  children,
}: {
  user: SessionUser
  children: React.ReactNode
}) {
  const loading = useRouteLoading()
  const [menuOpen, setMenuOpen] = useState(false)
  const router = useRouter()

  /*
   * Once the screen's own title scrolls behind the header, the header takes it
   * over — otherwise a long table leaves you with no indication of where you
   * are beyond the app's name, which you already know.
   */
  const page = useSyncExternalStore(subscribePageTitle, getPageTitle, getServerPageTitle)
  const showPageName = page.scrolledPast && page.title !== null

  /*
   * Closed once a navigation resolves, rather than on each link's click: a click
   * handler would miss the browser Back button, leaving the drawer open over a
   * screen already navigated away from.
   *
   * A subscription rather than an effect watching the pathname — the router is
   * the external system here, and syncing its state into React state on every
   * render is the cascading-render pattern `react-hooks` rightly rejects.
   */
  useEffect(
    () =>
      router.subscribe('onResolved', () => {
        setMenuOpen(false)
      }),
    [router],
  )

  return (
    <div className={styles.shell}>
      <RouteProgress loading={loading} />

      {/* Below the sidebar's breakpoint only — see the stylesheet. */}
      <header className={styles.topBar}>
        <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Dialog.Trigger className={styles.hamburger} aria-label="Open navigation">
            <span aria-hidden="true">☰</span>
          </Dialog.Trigger>

          <Dialog.Portal>
            <Dialog.Overlay className={styles.overlay} />
            {/* Radix supplies the focus trap, Escape handling, scroll lock and
                `aria-modal` — the parts of a drawer that are easy to get subtly
                wrong by hand. */}
            <Dialog.Content className={styles.drawer} aria-label="Main navigation">
              <Dialog.Title className="visually-hidden">Navigation</Dialog.Title>
              <div className={styles.drawerHead}>
                <Brand />
                <Dialog.Close className={styles.drawerClose} aria-label="Close navigation">
                  <span aria-hidden="true">✕</span>
                </Dialog.Close>
              </div>
              <nav className={styles.drawerNav}>
                <SidebarNav user={user} />
              </nav>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* Both rendered, one faded out: crossfading between them keeps the bar
            from reflowing as the text swaps mid-scroll. `aria-hidden` on the
            inactive one stops a screen reader announcing both. */}
        <span className={styles.topBarLabel}>
          <span className={cx(styles.labelSlot, showPageName && styles.labelHidden)}
                aria-hidden={showPageName}>
            <Brand />
          </span>
          <span className={cx(styles.labelSlot, styles.pageName, !showPageName && styles.labelHidden)}
                aria-hidden={!showPageName}>
            {page.title}
          </span>
        </span>
      </header>

      <nav className={styles.sidebar} aria-label="Main navigation">
        <Brand />
        <SidebarNav user={user} />
      </nav>

      {/* Dimmed while a navigation is in flight, so the figures on screen are
          visibly the previous route's rather than the one being opened. */}
      <main
        id="main"
        className={cx(styles.content, loading && styles.contentBusy)}
        aria-busy={loading}
      >
        {children}
      </main>
    </div>
  )
}
