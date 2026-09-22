/**
 * Lets this browser subscribe to exit-rule push notifications.
 *
 * A Settings toggle rather than a section on the Exits screen: subscribing is
 * a device capability, independent of which screen happens to trigger a
 * notification today — the same category as "Check connections" above it.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import styles from './PushNotificationSettings.module.scss'
import { disablePush, enablePush, refreshPushState, usePush } from './pushStore'
import { pushConfigured } from '~/lib/notifications/vapid'
import { countMyPushSubscriptions } from '~/server/notifications'

export function PushNotificationSettings() {
  const state = usePush()
  const queryClient = useQueryClient()
  const configured = pushConfigured()

  useEffect(() => {
    void refreshPushState()
  }, [])

  const { data: deviceCount = 0 } = useQuery({
    queryKey: ['push-subscriptions'],
    queryFn: () => countMyPushSubscriptions(),
    enabled: configured,
  })

  if (!configured) {
    return <p className={styles.note}>Push notifications are not configured on this server.</p>
  }
  if (!state.supported) {
    return <p className={styles.note}>This browser does not support push notifications.</p>
  }
  if (state.permission === 'denied') {
    return (
      <p className={styles.note}>
        Notifications are blocked for this site in your browser settings.
      </p>
    )
  }

  const toggle = async () => {
    await (state.subscribed ? disablePush() : enablePush())
    void queryClient.invalidateQueries({ queryKey: ['push-subscriptions'] })
  }

  return (
    <div className={styles.row}>
      <p className={styles.desc}>
        {state.subscribed
          ? `This device gets a notification whenever an exit-rule recommendation changes${
              deviceCount > 1 ? ` (${String(deviceCount)} devices enabled)` : ''
            }.`
          : 'Get a notification on this device whenever an exit-rule recommendation changes.'}
      </p>
      <button
        type="button"
        className={styles.button}
        disabled={state.pending}
        onClick={() => {
          void toggle()
        }}
      >
        {state.pending ? 'Working…' : state.subscribed ? 'Disable on this device' : 'Enable on this device'}
      </button>
      {state.error ? <p className={styles.error}>{state.error}</p> : null}
    </div>
  )
}
