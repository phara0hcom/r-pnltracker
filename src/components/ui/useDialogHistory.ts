/**
 * Lets the browser's Back close a dialog — see `dialogHistory.ts` for how, and
 * why the router must not hear of it.
 *
 * `open` is whether the dialog is showing; `onDismiss` closes it the same way
 * its ✕ does. Nothing happens outside a router (component tests render dialogs
 * on their own) or on the server, where effects do not run.
 */
import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { browserDialogHistory, type RouterHistoryLike } from './dialogHistory'

export function useDialogHistory(open: boolean, onDismiss: () => void): void {
  const router = useRouter({ warn: false })
  // Undefined outside a provider, whatever its type says — `warn: false` is
  // exactly the case where it returns nothing instead of throwing.
  const history: RouterHistoryLike | undefined = (router as typeof router | undefined)?.history
  const dismiss = useRef(onDismiss)
  const token = useRef<string | null>(null)

  // The latest closer, without re-running the effect below whenever the
  // caller passes a new arrow: a re-run would release and reacquire the entry.
  useEffect(() => {
    dismiss.current = onDismiss
  })

  useEffect(() => {
    if (!open || !history) return
    const dialogs = browserDialogHistory(history)
    const held = dialogs.acquire(token.current, () => {
      dismiss.current()
    })
    token.current = held
    return () => {
      dialogs.release(held)
    }
  }, [open, history])
}
