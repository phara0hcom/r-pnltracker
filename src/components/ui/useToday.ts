/**
 * Today's local date, or null while the server's render is being hydrated.
 *
 * The server's clock is UTC and a phone's is not, so a date read during render
 * would mark a different day on each side of hydration for nine hours of every
 * JST morning. `useSyncExternalStore` hands hydration the server's answer and
 * the browser's straight after, without an effect that sets state.
 *
 * Not re-read at midnight: a screen left open overnight keeps yesterday until
 * it next renders, which is as stale as anything else it shows.
 */
import { useSyncExternalStore } from 'react'
import { todayLocal } from '~/lib/localDate'

const subscribe = (): (() => void) => () => undefined

const getSnapshot = (): string => todayLocal()

const getServerSnapshot = (): null => null

export function useToday(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
