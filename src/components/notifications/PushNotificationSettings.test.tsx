/**
 * The three gates this toggle has to get right before it ever touches the
 * Push API — unconfigured, unsupported, and blocked — plus the enable round
 * trip actually reaching the server with the subscription it obtained.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PushNotificationSettings } from './PushNotificationSettings'

const queryClient = vi.hoisted(() => ({ invalidateQueries: vi.fn(() => Promise.resolve()) }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => queryClient,
  useQuery: () => ({ data: 0 }),
}))

const vapid = vi.hoisted(() => ({
  pushConfigured: vi.fn(() => true),
  vapidPublicKey: vi.fn(() => 'AAAA'),
}))
vi.mock('~/lib/notifications/vapid', () => vapid)

const server = vi.hoisted(() => ({
  register: vi.fn(() => Promise.resolve({ ok: true as const })),
  unregister: vi.fn(() => Promise.resolve({ ok: true as const })),
  count: vi.fn(() => Promise.resolve(0)),
}))
vi.mock('~/server/notifications', () => ({
  registerPushSubscription: server.register,
  unregisterPushSubscription: server.unregister,
  countMyPushSubscriptions: server.count,
}))

const ENDPOINT = 'https://push.example.com/abc'

interface BrowserFixture {
  permission: NotificationPermission
  existingSubscription?: boolean
}

function installBrowserPushApis({ permission, existingSubscription = false }: BrowserFixture) {
  const subscriptionStub = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p-key', auth: 'a-key' } }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  }

  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(existingSubscription ? subscriptionStub : null)),
    subscribe: vi.fn(() => Promise.resolve(subscriptionStub)),
  }

  // Only feature-detected via `in window` — never constructed — so any truthy value stands in.
  Object.defineProperty(window, 'PushManager', { value: {}, configurable: true })
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  })
  Object.defineProperty(window, 'Notification', {
    value: { permission, requestPermission: vi.fn(() => Promise.resolve(permission)) },
    configurable: true,
  })

  return { pushManager, subscriptionStub }
}

function removeBrowserPushApis() {
  for (const name of ['PushManager', 'Notification']) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test cleanup only
    delete (window as unknown as Record<string, unknown>)[name]
  }
  delete (navigator as unknown as Record<string, unknown>).serviceWorker
}

afterEach(() => {
  removeBrowserPushApis()
  vi.clearAllMocks()
})

describe('PushNotificationSettings', () => {
  it('says the server has not configured push, and asks nothing of the browser', () => {
    vapid.pushConfigured.mockReturnValue(false)
    render(<PushNotificationSettings />)
    expect(screen.getByText(/not configured on this server/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says the browser cannot do this, when the server is configured but PushManager is missing', async () => {
    vapid.pushConfigured.mockReturnValue(true)
    render(<PushNotificationSettings />)
    expect(await screen.findByText(/does not support push notifications/)).toBeTruthy()
  })

  it('says notifications are blocked, without offering the button', async () => {
    vapid.pushConfigured.mockReturnValue(true)
    installBrowserPushApis({ permission: 'denied' })
    render(<PushNotificationSettings />)
    expect(await screen.findByText(/blocked for this site/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('subscribes this browser and registers it with the server', async () => {
    vapid.pushConfigured.mockReturnValue(true)
    const { pushManager } = installBrowserPushApis({ permission: 'granted' })
    render(<PushNotificationSettings />)

    const button = await screen.findByRole('button', { name: 'Enable on this device' })
    await userEvent.click(button)

    await waitFor(() => {
      expect(server.register).toHaveBeenCalledWith({
        data: { endpoint: ENDPOINT, p256dh: 'p-key', auth: 'a-key', userAgent: navigator.userAgent },
      })
    })
    expect(pushManager.subscribe).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Disable on this device' })).toBeTruthy()
  })

  it('unsubscribes this browser and forgets it server-side', async () => {
    vapid.pushConfigured.mockReturnValue(true)
    const { subscriptionStub } = installBrowserPushApis({ permission: 'granted', existingSubscription: true })
    render(<PushNotificationSettings />)

    const button = await screen.findByRole('button', { name: 'Disable on this device' })
    await userEvent.click(button)

    await waitFor(() => {
      expect(server.unregister).toHaveBeenCalledWith({ data: { endpoint: ENDPOINT } })
    })
    expect(subscriptionStub.unsubscribe).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Enable on this device' })).toBeTruthy()
  })
})
